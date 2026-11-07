// Where a Database's Postgres clients come from: the app's Pool, or a connection string (Hyperdrive's or the app's), a client per `withDatabase` scope or per operation.
import pg from "pg";
import { connectTimeoutOf } from "./connect-timeout.ts";

type Client = InstanceType<typeof pg.Client>;

/** Reads a column's text, by its type's OID, as a JavaScript value: `pg`'s `types` option. */
export interface TypeParsers {
  getTypeParser(oid: number, format?: string): (text: string) => unknown;
}

/** One query, as `pg`'s `query` takes it. */
export interface QueryConfig {
  text: string;
  values?: unknown[];
  types?: TypeParsers;
}

/** What `pg`'s `query` resolves to, as far as this adapter reads it. */
export interface QueryResult {
  rows: Record<string, unknown>[];
  rowCount: number | null;
  command: string;
}

/** What sends a query: a client of `pg`'s. */
export interface Queryable {
  query(config: QueryConfig): Promise<QueryResult>;
}

/** A client lent by a `pg` Pool, released when it's done. */
interface PoolClient extends Queryable {
  release(error?: Error | boolean): void;
}

/** A `pg` Pool, as `connect` takes it: the app's own, which the app ends. */
export interface Pool {
  connect(): Promise<PoolClient>;
  /** What it was built with: its connection string, when it was built from one. */
  readonly options?: { readonly connectionString?: string | undefined };
}

/** A client for one operation, and what to do when the operation is done with it. */
export interface Lease {
  client: Queryable;
  /** Gives the client back; `error`, when the operation failed, so a broken client isn't reused. */
  done(error?: unknown): Promise<void>;
}

/**
 * The connection string a source opens its clients from: a Hyperdrive binding's, or the source
 * itself when it's one. Undefined for anything else, such as a Pool.
 */
export function connectionStringOf(source: unknown): string | undefined {
  if (typeof source === "string") return source;
  const held = (source as { connectionString?: unknown } | undefined)?.connectionString;
  return typeof held === "string" ? held : undefined;
}

/** Where a Database's clients come from. */
export interface Clients {
  /** A client for one statement, or one read batch: `scope`'s, while it's open. */
  borrow(scope?: ClientScope): Promise<Lease>;
  /** A client of its own, which nothing else sends on: for a write batch's transaction. */
  own(): Promise<Lease>;
  /** A `withDatabase` scope has begun, and ended (see the core's `Driver`). */
  openScope?(): ClientScope;
  closeScope?(scope: ClientScope): Promise<void>;
}

/** Clients lent by the app's Pool. */
export class PoolClients implements Clients {
  readonly #pool: Pool;

  constructor(pool: Pool) {
    this.#pool = pool;
  }

  async borrow(): Promise<Lease> {
    const client = await this.#pool.connect();
    return {
      client,
      done: async (error) => client.release(error instanceof Error ? error : undefined),
    };
  }

  own(): Promise<Lease> {
    return this.borrow();
  }
}

/**
 * One `withDatabase` scope's client: opened by its first operation, it serves the rest, one at a
 * time, and closes when the scope ends and the operations sent before then are done.
 */
export class ClientScope {
  readonly #open: () => Promise<Client>;
  /** The client, once an operation has asked for it. */
  #client: Promise<Client> | undefined;
  /**
   * Settles when the latest operation is done. Each waits for the one before it, so `pg` never
   * gets a query while another is running (its queue for those is deprecated), and closing the
   * client waits for the last.
   */
  #lastDone: Promise<void> = Promise.resolve();
  #hasEnded = false;

  constructor(open: () => Promise<Client>) {
    this.#open = open;
  }

  /** Whether the scope has ended: an operation sent after it (a `waitUntil` save) opens its own. */
  get hasEnded(): boolean {
    return this.#hasEnded;
  }

  async lease(): Promise<Lease> {
    // Queued before anything is awaited, so the scope ending meanwhile waits for this operation.
    const previous = this.#lastDone;
    let finish = () => {};
    this.#lastDone = new Promise<void>((resolve) => (finish = resolve));
    await previous;
    // Asked for on its turn: a client the operation before it lost is replaced.
    const opening = this.#opened();
    const done = async (error?: unknown) => {
      if (isSessionEnding(error)) this.#forget(opening);
      finish();
    };
    try {
      return { client: await opening, done };
    } catch (error) {
      await done();
      throw error;
    }
  }

  /**
   * Ends the scope at once, and closes its client in the background once its operations are
   * done, so a query still running (a `waitUntil` save's) never holds up the response.
   */
  end(): void {
    this.#hasEnded = true;
    void this.#closeWhenDone();
  }

  /** Closes the client the scope holds once its last operation is done, if it holds one. */
  async #closeWhenDone(): Promise<void> {
    await this.#lastDone;
    const client = await this.#client?.catch(() => undefined);
    if (client !== undefined) await closed(client);
  }

  /**
   * The client, opened on first use. A failed open is tried again by the next operation, and so
   * is a client whose connection has gone, as `pg` reports it (`error` on the client itself, then
   * `end`) or the server does (`isSessionEnding`). An error that leaves the connection healthy,
   * such as `pg` refusing a value before sending it, never costs the scope its client.
   */
  #opened(): Promise<Client> {
    if (this.#client !== undefined) return this.#client;
    const opening: Promise<Client> = this.#open().then(
      (client) =>
        client.on("error", () => this.#forget(opening)).once("end", () => this.#forget(opening)),
      (error: unknown) => {
        this.#forget(opening);
        throw error;
      },
    );
    this.#client = opening;
    return opening;
  }

  #forget(opening: Promise<Client>): void {
    if (this.#client === opening) this.#client = undefined;
  }
}

/**
 * Clients opened from a connection string. Inside a `withDatabase` scope, its client serves each
 * operation (`ClientScope`). Outside one, before it or after it, each operation opens its own and
 * closes it when it's done, as no client may outlive a Worker's request.
 */
export class UrlClients implements Clients {
  readonly #connectionString: string;
  /** How long opening a client may take, in milliseconds: no limit when 0. */
  readonly #connectTimeout: number;

  constructor(connectionString: string) {
    this.#connectionString = connectionString;
    this.#connectTimeout = connectTimeoutOf(connectionString);
  }

  openScope(): ClientScope {
    return new ClientScope(() => this.#open());
  }

  async closeScope(scope: ClientScope): Promise<void> {
    scope.end();
  }

  borrow(scope?: ClientScope): Promise<Lease> {
    return scope === undefined || scope.hasEnded ? this.own() : scope.lease();
  }

  async own(): Promise<Lease> {
    const client = await this.#open();
    return { client, done: () => closed(client) };
  }

  async #open(): Promise<Client> {
    const client = new pg.Client({
      connectionString: this.#connectionString,
      connectionTimeoutMillis: this.#connectTimeout,
    });
    // A connection lost while idle is reported here; unheard, it would crash a Node process.
    client.on("error", () => {});
    await client.connect();
    return client;
  }
}

/** Whether the server sent `error` as it ends the session: a `FATAL` or `PANIC` (57P01, a terminated backend). */
function isSessionEnding(error: unknown): boolean {
  const severity = (error as { severity?: unknown } | undefined)?.severity;
  return severity === "FATAL" || severity === "PANIC";
}

/** Ends `client`. A connection that fails to close has nothing left to do, so it's not an error. */
async function closed(client: Client): Promise<void> {
  await client.end().catch(() => {});
}
