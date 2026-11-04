// Which D1 database a query from a Model's statics uses: the request's for its binding, or the binding's own from `cloudflare:workers` (#77). A binding's own Database holds no per-request state.
import {
  AnyDatabase,
  databaseExecutor,
  DatabaseExecutor,
} from "@forestfuture/active-record/adapter";
import { NoDatabase } from "@forestfuture/active-record";
import { d1Adapter } from "./adapter.ts";
import type { Database } from "./database.ts";
import { D1Driver } from "./driver.ts";

/** @internal The library's key for a D1 database's binding and Driver. */
export const d1Parts = Symbol("d1Parts");

type Env = Record<string, unknown>;

/** The Worker's bindings, from `cloudflare:workers`; undefined outside a Worker (Node, scripts). */
let workersEnv: Promise<Env | undefined> | undefined;

function bindings(): Promise<Env | undefined> {
  // A literal specifier: Wrangler and Miniflare (wrangler dev) only allow those. Outside a Worker
  // the module doesn't exist, which is the one failure that means "not in a Worker".
  workersEnv ??= import("cloudflare:workers").then(
    (workers) => workers.env as unknown as Env,
    (error: unknown) => {
      if (notAWorker(error)) return undefined;
      throw error;
    },
  );
  return workersEnv;
}

/** Whether importing `cloudflare:workers` failed because this isn't a Worker (Node, scripts). */
function notAWorker(error: unknown): boolean {
  const { code, message } = error as { code?: unknown; message?: unknown };
  return (
    code === "ERR_UNSUPPORTED_ESM_URL_SCHEME" ||
    code === "ERR_MODULE_NOT_FOUND" ||
    /cloudflare:workers/.test(String(message))
  );
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
  const env = name === undefined ? undefined : await bindings();
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
