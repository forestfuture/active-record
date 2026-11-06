// Which D1 database a query from a Model's statics uses: the request's for its binding, or the binding's own from `cloudflare:workers` (#77). A binding's own Database holds no per-request state.
import {
  AnyDatabase,
  databaseExecutor,
  DatabaseExecutor,
  workersEnv,
  type WorkersEnv,
} from "@forestfuture/active-record/adapter";
import { NoDatabase } from "@forestfuture/active-record";
import { d1Adapter } from "./adapter.ts";
import type { Database } from "./database.ts";
import { D1Driver } from "./driver.ts";

/** @internal The library's key for a D1 database's binding and Driver. */
export const d1Parts = Symbol("d1Parts");

/** The Worker's bindings, from `cloudflare:workers`, read once; undefined outside a Worker. */
let bindings: Promise<WorkersEnv | undefined> | undefined;

/** The `env` a test mocks with d1-record inlined is this module's import, so it's imported here. */
function workerBindings(): Promise<WorkersEnv | undefined> {
  bindings ??= workersEnv(() => import("cloudflare:workers"));
  return bindings;
}

/** One Database per D1 binding, for queries outside `withDatabase`: it holds nothing per-request. */
const defaults = new WeakMap<D1Database, AnyDatabase>();

function defaultDatabase(binding: D1Database, name: string): AnyDatabase {
  let db = defaults.get(binding);
  if (db === undefined) {
    db = new AnyDatabase(new DatabaseExecutor(d1Adapter, new D1Driver(binding)));
    db[databaseExecutor].setOrigin({ binding: name });
    defaults.set(binding, db);
  }
  return db;
}

/** Why there's no database here, saying what to do. */
function noDatabase(reason: string): NoDatabase {
  return new NoDatabase(
    `No database for this query: ${reason}. Wrap the code in withDatabase(connect(env.DB), …), ` +
      "or use db.model(Model)",
  );
}

/** Outside a Worker (Node, scripts), a request's database is the only one there can be. */
function onlyRequested(requested: readonly AnyDatabase[], name: string | undefined): AnyDatabase {
  if (requested.length === 1) return requested[0]!;
  if (requested.length > 1) {
    throw noDatabase(
      "withDatabase was given several, and outside a Worker a binding can't tell which",
    );
  }
  throw noDatabase(
    name === undefined
      ? "its Model's base class holds no generated schema, which names its binding"
      : `the binding ${name} is only there inside a Worker`,
  );
}

/** The database a query on binding `name` uses now: the request's for it, or the binding's own. */
export async function databaseFor(
  name: string | undefined,
  requested: readonly AnyDatabase[],
): Promise<AnyDatabase> {
  const env = name === undefined ? undefined : await workerBindings();
  if (env === undefined || name === undefined) return onlyRequested(requested, name);
  const binding = env[name] as D1Database | undefined;
  if (binding === undefined) {
    throw new NoDatabase(
      `The binding ${name} isn't in this Worker's env; check d1_databases in your Wrangler config`,
    );
  }
  return (
    requested.find((db) => d1Parts in db && (db as Database)[d1Parts].binding === binding) ??
    defaultDatabase(binding, name)
  );
}
