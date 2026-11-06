// `withDatabase`, and where a query from a Model's statics (`Product.find(id)`) finds its database:
// the request's, set with `withDatabase`, or else whatever its adapter finds (#77). Nothing
// per-request is ever stored on a class (ADR-0003): a request's database lives only in its
// AsyncLocalStorage.
import { schemaAdapter } from "./generated-model.ts";
import type { Adapter, SchemaAdapter } from "./adapter.ts";
import { databaseExecutor, type AnyDatabase } from "./database.ts";
import { NoDatabase } from "./errors.ts";
import { CurrentExecutor, type DatabaseExecutor, type Executor } from "./executor.ts";
import type { ModelClass, ScopesOf } from "./model.ts";
import { requestStore, runWithStore } from "./request-store.ts";
import type { Scoped } from "./relation.ts";
import { relationFor } from "./scoped-relation.ts";

/**
 * Runs `fn` with `databases` as the request's own: queries started from a Model inside it (and
 * everything it awaits) use the one on that Model's binding, with its Session and `onQuery`.
 * Usually called once per request, in middleware. Nested calls add to the outer ones. Each call
 * is a scope of its own, even with a Database another request shares: an adapter may hold a
 * connection for it (pg-record, from a connection string), let go when `fn` settles, which a
 * nested call with the same Database shares. Work that outlives it, such as a `waitUntil` save,
 * gets its own.
 */
export async function withDatabase<R>(
  databases: AnyDatabase | readonly AnyDatabase[],
  fn: () => R | Promise<R>,
): Promise<R> {
  const outer = requestStore();
  const inner = Array.isArray(databases) ? databases : [databases as AnyDatabase];
  const scopes = new Map(outer?.scopes);
  const opened = openScopes(inner, scopes);
  try {
    return await runWithStore({ databases: [...inner, ...(outer?.databases ?? [])], scopes }, fn);
  } finally {
    // An adapter may hold a connection for the scope (pg-record): it's let go now.
    await Promise.all(opened.map(([executor, scope]) => executor.closeScope(scope)));
  }
}

/** Opens a scope for each of `databases` not already in one, added to `scopes`; the ones opened. */
function openScopes(
  databases: readonly AnyDatabase[],
  scopes: Map<DatabaseExecutor, unknown>,
): [DatabaseExecutor, unknown][] {
  const opened: [DatabaseExecutor, unknown][] = [];
  for (const db of databases) {
    const executor = db[databaseExecutor];
    executor.setOrigin("request");
    if (scopes.has(executor)) continue;
    const scope = executor.openScope();
    scopes.set(executor, scope);
    opened.push([executor, scope]);
  }
  return opened;
}

/**
 * The adapter a statement compiles for. Statements compile when they're built, before their
 * database is found, so this can't wait to find it: the one its Model's schema names, or else
 * the request's database's. A Model with neither can't compile, so it throws `NoDatabase`.
 */
function adapterFor(named: SchemaAdapter | undefined): Adapter {
  if (named !== undefined) return named.adapter;
  const [first] = requestStore()?.databases ?? [];
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
  return adapterFor(named).databaseFor(named?.binding, requestStore()?.databases ?? []);
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
