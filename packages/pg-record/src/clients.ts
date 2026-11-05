// Where a Database's Postgres clients come from: the app's Pool, or a connection string (Hyperdrive's or the app's), a client per scope or per operation.
import pg from "pg";

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
export interface PoolClient extends Queryable {
  release(error?: Error | boolean): void;
}

/** A `pg` Pool, as `connect` takes it: the app's own, which the app ends. */
export interface Pool {
  connect(): Promise<PoolClient>;
}

/** A client for one operation, and what to do when the operation is done with it. */
export interface Lease {
  client: Queryable;
  /** Gives the client back; `error`, when the operation failed, so a broken client isn't reused. */
  done(error?: unknown): Promise<void>;
}

/** Where a Database's clients come from. */
export interface Clients {
  /** A client for one statement, or one read batch. */
  borrow(): Promise<Lease>;
  /** A client of its own, which nothing else sends on: for a write batch's transaction. */
  own(): Promise<Lease>;
  /** A `withDatabase` scope has begun, and ended (see the core's `Driver`). */
  enterScope?(): void;
  leaveScope?(): Promise<void>;
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
 * Clients opened from a connection string. Inside a `withDatabase` scope, one opens on the first
 * operation and serves the rest until the scope ends. Outside one, before it or after it, each
 * operation opens its own and closes it when it's done, as no client may outlive a Worker's
 * request.
 */
export class UrlClients implements Clients {
  readonly #connectionString: string;
  /** How many scopes are open: they nest. */
  #depth = 0;
  /** The open scope's client, once an operation has asked for it. */
  #scoped: Promise<Client> | undefined;
  /** The scope client's operations not yet done, which its scope waits for before closing it. */
  readonly #busy = new Set<Promise<void>>();

  constructor(connectionString: string) {
    this.#connectionString = connectionString;
  }

  enterScope(): void {
    this.#depth += 1;
  }

  /** Closes the scope's client once its last scope has ended and its operations are done. */
  async leaveScope(): Promise<void> {
    this.#depth = Math.max(0, this.#depth - 1);
    const scoped = this.#scoped;
    if (this.#depth > 0 || scoped === undefined) return;
    this.#scoped = undefined;
    await Promise.allSettled(this.#busy);
    const client = await scoped.catch(() => undefined);
    if (client !== undefined) await closed(client);
  }

  async borrow(): Promise<Lease> {
    if (this.#depth === 0) return this.own();
    // Counted before the client is awaited, so a scope ending meanwhile waits for this operation.
    let finish = () => {};
    const busy = new Promise<void>((resolve) => (finish = resolve));
    this.#busy.add(busy);
    const done = async () => {
      this.#busy.delete(busy);
      finish();
    };
    try {
      return { client: await this.#scopeClient(), done };
    } catch (error) {
      await done();
      throw error;
    }
  }

  async own(): Promise<Lease> {
    const client = await this.#open();
    return { client, done: () => closed(client) };
  }

  /** The scope's client, opened on first use; a failed open is tried again by the next. */
  #scopeClient(): Promise<Client> {
    this.#scoped ??= this.#open().catch((error: unknown) => {
      this.#scoped = undefined;
      throw error;
    });
    return this.#scoped;
  }

  async #open(): Promise<Client> {
    const client = new pg.Client({ connectionString: this.#connectionString });
    // A connection lost while idle is reported here; unheard, it would crash a Node process.
    client.on("error", () => {});
    await client.connect();
    return client;
  }
}

/** Ends `client`. A connection that fails to close has nothing left to do, so it's not an error. */
async function closed(client: Client): Promise<void> {
  await client.end().catch(() => {});
}
