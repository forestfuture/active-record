// Which Postgres database a query from a Model's statics uses: the request's for its binding (or its one Pool), or the binding's own, from the Worker's env (a Hyperdrive binding or a connection string). A binding's own Database holds no client between operations.
import {
  AnyDatabase,
  DatabaseExecutor,
  databaseExecutor,
  onlyRequested,
  workersEnv,
  type WorkersEnv,
} from "@forestfuture/active-record/adapter";
import { NoDatabase } from "@forestfuture/active-record";
import { pgAdapter } from "./adapter.ts";
import { connectionStringOf, UrlClients } from "./clients.ts";
import { isObject } from "./is-object.ts";
import { PgDriver } from "./driver.ts";

/** The Worker's bindings, from `cloudflare:workers`, read once; undefined outside a Worker. */
let bindings: Promise<WorkersEnv | undefined> | undefined;

/** The `env` a test mocks with pg-record inlined is this module's import, so it's imported here. */
function workerBindings(): Promise<WorkersEnv | undefined> {
  bindings ??= workersEnv(() => import("cloudflare:workers"));
  return bindings;
}

/** @internal The library's key for the connection string a Database opens its clients from. */
export const pgConnectionString = Symbol("pgConnectionString");

/**
 * Each binding's own Database: a Hyperdrive binding's kept by the binding, so it goes when the
 * binding does; a connection string's by the string, of which a Worker's env holds a few.
 */
const byHyperdrive = new WeakMap<object, AnyDatabase>();
const byString = new Map<string, AnyDatabase>();

function defaultDatabase(binding: unknown, connectionString: string, name: string): AnyDatabase {
  const hyperdrive = isObject(binding) ? binding : undefined;
  let db = hyperdrive === undefined ? byString.get(connectionString) : byHyperdrive.get(hyperdrive);
  if (db === undefined) {
    db = new AnyDatabase(
      new DatabaseExecutor(pgAdapter, new PgDriver(new UrlClients(connectionString))),
    );
    db[databaseExecutor].setOrigin({ binding: name });
    if (hyperdrive === undefined) byString.set(connectionString, db);
    else byHyperdrive.set(hyperdrive, db);
  }
  return db;
}

/** The connection string a request's Postgres database opens its clients from; undefined for a Pool's. */
const dbConnectionString = (db: AnyDatabase) =>
  (db as { [pgConnectionString]?: string })[pgConnectionString];

/**
 * The request's Postgres database for a binding on `connectionString`: the one opened from it,
 * or else its only one from a Pool, which has no connection string to match.
 */
function requestedFor(
  connectionString: string,
  requested: readonly AnyDatabase[],
): AnyDatabase | undefined {
  const postgres = requested.filter((db) => db[databaseExecutor].adapter === pgAdapter);
  const matched = postgres.find((db) => dbConnectionString(db) === connectionString);
  if (matched !== undefined) return matched;
  const pools = postgres.filter((db) => dbConnectionString(db) === undefined);
  return pools.length === 1 ? pools[0] : undefined;
}

/** The database a query on binding `name` uses now: the request's for it, or the binding's own. */
export async function databaseFor(
  name: string | undefined,
  requested: readonly AnyDatabase[],
): Promise<AnyDatabase> {
  const env = name === undefined ? undefined : await workerBindings();
  if (env === undefined || name === undefined) return onlyRequested(requested, name, "connect(…)");
  const binding = env[name];
  const connectionString = connectionStringOf(binding);
  if (connectionString === undefined) {
    throw new NoDatabase(
      `The binding ${name} isn't in this Worker's env as a Hyperdrive binding or a connection ` +
        "string; check hyperdrive in your Wrangler config",
    );
  }
  return (
    requestedFor(connectionString, requested) ?? defaultDatabase(binding, connectionString, name)
  );
}
