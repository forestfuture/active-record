// Which Postgres database a query from a Model's statics uses: the request's for its binding, or the binding's own, from the Worker's env (a Hyperdrive binding or a connection string). A binding's own Database holds no client between operations.
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

/** One Database per connection string, for queries outside `withDatabase`. */
const defaults = new Map<string, AnyDatabase>();

function defaultDatabase(connectionString: string, name: string): AnyDatabase {
  let db = defaults.get(connectionString);
  if (db === undefined) {
    db = new AnyDatabase(
      new DatabaseExecutor(pgAdapter, new PgDriver(new UrlClients(connectionString))),
    );
    db[databaseExecutor].setOrigin({ binding: name });
    defaults.set(connectionString, db);
  }
  return db;
}

/** The database a query on binding `name` uses now: the request's for it, or the binding's own. */
export async function databaseFor(
  name: string | undefined,
  requested: readonly AnyDatabase[],
): Promise<AnyDatabase> {
  const env = name === undefined ? undefined : await workerBindings();
  if (env === undefined || name === undefined) return onlyRequested(requested, name, "connect(…)");
  const connectionString = connectionStringOf(env[name]);
  if (connectionString === undefined) {
    throw new NoDatabase(
      `The binding ${name} isn't in this Worker's env as a Hyperdrive binding or a connection ` +
        "string; check hyperdrive in your Wrangler config",
    );
  }
  return (
    requested.find(
      (db) => (db as { [pgConnectionString]?: string })[pgConnectionString] === connectionString,
    ) ?? defaultDatabase(connectionString, name)
  );
}
