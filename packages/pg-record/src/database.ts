// The `Database` that `connect` returns: Postgres through a Hyperdrive binding, a connection string, or the app's Pool.
import {
  AnyDatabase,
  DatabaseExecutor,
  type QueryEvent as AnyQueryEvent,
  type QueryListener as AnyQueryListener,
} from "@forestfuture/active-record/adapter";
import { pgAdapter } from "./adapter.ts";
import { type Clients, connectionStringOf, type Pool, PoolClients, UrlClients } from "./clients.ts";
import { pgConnectionString } from "./current-database.ts";
import { PgDriver, type PgMeta } from "./driver.ts";

/** What `onQuery` hears about a statement: its Model, SQL, bound values, timing, and Postgres's `meta`. */
export type QueryEvent = AnyQueryEvent<PgMeta>;

/** Hears each statement's `QueryEvent`, with Postgres's `meta`. */
export type QueryListener = AnyQueryListener<PgMeta>;

export interface ConnectOptions {
  /** Called once for every statement sent to Postgres, with Postgres's `meta`. */
  onQuery?: QueryListener;
}

/** Where a Database's Postgres is: a Hyperdrive binding (`env.HYPERDRIVE`), a connection string, or a `pg` Pool. */
export type PgSource = Hyperdrive | string | Pool;

function clientsFor(source: PgSource): Clients {
  const connectionString = connectionStringOf(source);
  return connectionString === undefined
    ? new PoolClients(source as Pool)
    : new UrlClients(connectionString);
}

/**
 * A handle on a Postgres database; every query goes through it. `db.batch` writes in one
 * transaction, on a client of its own.
 */
export class Database extends AnyDatabase {
  readonly #connectionString: string | undefined;

  constructor(source: PgSource, options: ConnectOptions = {}) {
    super(new DatabaseExecutor(pgAdapter, new PgDriver(clientsFor(source)), options.onQuery));
    this.#connectionString =
      connectionStringOf(source) ?? (source as Pool).options?.connectionString;
  }

  /**
   * @internal Its connection string, to match a Model's binding: a Pool's, when it was built from
   * one. A Pool built any other way matches none.
   */
  get [pgConnectionString](): string | undefined {
    return this.#connectionString;
  }
}

export function connect(source: PgSource, options?: ConnectOptions): Database {
  return new Database(source, options);
}
