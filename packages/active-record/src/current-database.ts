// `withDatabase`, and where a query from a Model's statics (`Product.find(id)`) finds its database:
// the request's, set with `withDatabase`, or else whatever its adapter finds (#77). Nothing
// per-request is ever stored on a class (ADR-0003): a request's database lives only in its
// AsyncLocalStorage.
import { schemaAdapter } from "./generated-model.ts";
import type { Adapter, SchemaAdapter } from "./adapter.ts";
import { databaseExecutor, type AnyDatabase } from "./database.ts";
import { NoDatabase } from "./errors.ts";
import { CurrentExecutor, type Executor } from "./executor.ts";
import type { ModelClass, ScopesOf } from "./model.ts";
import type { Scoped } from "./relation.ts";
import { relationFor } from "./scoped-relation.ts";

interface Storage<T> {
  getStore(): T | undefined;
  run<R>(store: T, fn: () => R): R;
}

/** The databases `withDatabase` set for the current request, once it's been called. */
let requests: Storage<readonly AnyDatabase[]> | undefined;

/** Node's AsyncLocalStorage, loaded when it's first needed, so Workers without Node.js compatibility still build. */
function newStorage(): Storage<readonly AnyDatabase[]> {
  const process = (globalThis as { process?: { getBuiltinModule?(id: string): unknown } }).process;
  const hooks = process?.getBuiltinModule?.("node:async_hooks") as
    | { AsyncLocalStorage: new () => Storage<readonly AnyDatabase[]> }
    | undefined;
  if (hooks === undefined) {
    throw new NoDatabase(
      "withDatabase needs Node.js compatibility: a compatibility_date of 2026-08-04 or later, " +
        "or the nodejs_compat flag, in your Wrangler config",
    );
  }
  return new hooks.AsyncLocalStorage();
}

/**
 * Runs `fn` with `databases` as the request's own: queries started from a Model inside it (and
 * everything it awaits) use the one on that Model's binding, with its Session and `onQuery`.
 * Usually called once per request, in middleware. Nested calls add to the outer ones. An adapter
 * may hold a connection for the scope (pg-record, from a connection string), let go when `fn`
 * settles; work that outlives it, such as a `waitUntil` save, gets its own.
 */
export async function withDatabase<R>(
  databases: AnyDatabase | readonly AnyDatabase[],
  fn: () => R | Promise<R>,
): Promise<R> {
  requests ??= newStorage();
  const outer = requests.getStore() ?? [];
  const inner = Array.isArray(databases) ? databases : [databases as AnyDatabase];
  const executors = inner.map((db) => db[databaseExecutor]);
  for (const executor of executors) {
    executor.setOrigin("request");
    executor.enterScope();
  }
  try {
    return await requests.run([...inner, ...outer], fn);
  } finally {
    // An adapter may hold a connection for the scope (pg-record): it's let go now.
    await Promise.all(executors.map((executor) => executor.leaveScope()));
  }
}

/**
 * The adapter a statement compiles for. Statements compile when they're built, before their
 * database is found, so this can't wait to find it: the one its Model's schema names, or else
 * the request's database's. A Model with neither can't compile, so it throws `NoDatabase`.
 */
function adapterFor(named: SchemaAdapter | undefined): Adapter {
  if (named !== undefined) return named.adapter;
  const [first] = requests?.getStore() ?? [];
  if (first === undefined) throw noSchemaOrDatabase();
  return first[databaseExecutor].adapter;
}

function noSchemaOrDatabase(): NoDatabase {
  return new NoDatabase(
    "No database for this query: its Model's base class holds no generated schema, which names " +
      "its adapter. Wrap the code in withDatabase(db, …), or use db.model(Model)",
  );
}

/** The database a query uses now, on the adapter its Model's schema names. */
function databaseFor(named: SchemaAdapter | undefined): Promise<AnyDatabase> {
  return adapterFor(named).databaseFor(named?.binding, requests?.getStore() ?? []);
}

/**
 * One Executor per adapter and binding (from a Model's schema), finding the current database each
 * time a query runs; Models on one binding share it, so their statements can share a batch.
 */
const executors = new Map<Adapter | undefined, Map<string | undefined, Executor>>();

/** The Executor for queries started from a Model whose schema names `named`. */
function currentExecutor(named: SchemaAdapter | undefined): Executor {
  let byBinding = executors.get(named?.adapter);
  if (byBinding === undefined) executors.set(named?.adapter, (byBinding = new Map()));
  let executor = byBinding.get(named?.binding);
  if (executor === undefined) {
    executor = new CurrentExecutor(
      () => adapterFor(named),
      async () => (await databaseFor(named))[databaseExecutor],
    );
    byBinding.set(named?.binding, executor);
  }
  return executor;
}

/** A Relation over all of `model`'s records, on the current database (`Product.all()`). */
export function currentRelation<C extends ModelClass>(
  model: C,
): Scoped<InstanceType<C>, ScopesOf<C>> {
  return relationFor(currentExecutor(schemaAdapter(model)), model);
}
