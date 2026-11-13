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
import { type DatabaseScope, requestStore, runWithStore } from "./request-store.ts";
import type { Scoped } from "./relation.ts";
import { relationFor } from "./scoped-relation.ts";

/**
 * Runs `fn` with `databases` as the request's own: queries started from a Model inside it (and
 * everything it awaits) use the one on that Model's binding, with its Session and `onQuery`.
 * Usually called once per request, in middleware. Nested calls add to the outer ones.
 *
 * Each call is a scope of its own, even with a Database another request shares. An adapter may
 * hold a connection for the scope (the PostgreSQL adapter does, from a connection string). A nested call with
 * the same Database shares the outer call's scope while that call is running. When `fn` settles,
 * the scope ends, and the adapter lets its connection go once the queries still running on it
 * finish. Work that outlives the scope, such as a `waitUntil` save, gets a connection of its own.
 */
export async function withDatabase<R>(
  databases: AnyDatabase | readonly AnyDatabase[],
  fn: () => R | Promise<R>,
): Promise<R> {
  const outer = requestStore();
  const inner = Array.isArray(databases) ? databases : [databases as AnyDatabase];
  const scopes = new Map(outer?.scopes);
  const opened: OpenedScope[] = [];
  try {
    openScopes(inner, scopes, opened);
    // A Database given twice, or again in a nested call, is one of the request's databases.
    const all = [...new Set([...inner, ...(outer?.databases ?? [])])];
    return await runWithStore({ databases: all, scopes }, fn);
  } finally {
    // The scopes end; an adapter lets their connections go once their queries finish.
    await Promise.all(
      opened.map(({ executor, scope }) => {
        scope.hasEnded = true;
        return executor.closeScope(scope.held);
      }),
    );
  }
}

/** A scope a `withDatabase` call opened, which it closes when it ends, and its database's. */
interface OpenedScope {
  executor: DatabaseExecutor;
  scope: DatabaseScope;
}

/**
 * Opens a scope for each of `databases` not already in a running one, added to `scopes` and to `opened` as
 * it opens, so the ones opened before a driver throws are still closed.
 */
function openScopes(
  databases: readonly AnyDatabase[],
  scopes: Map<DatabaseExecutor, DatabaseScope>,
  opened: OpenedScope[],
): void {
  for (const db of databases) {
    const executor = db[databaseExecutor];
    executor.setOrigin("request");
    // A call nested in one still running shares its scope; in one that has returned (a
    // `waitUntil`'s, started inside the request), it opens its own.
    if (scopes.get(executor)?.hasEnded === false) continue;
    const scope: DatabaseScope = { held: executor.openScope(), hasEnded: false };
    scopes.set(executor, scope);
    opened.push({ executor, scope });
  }
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

/**
 * The database a query uses now, on the adapter its Model's schema names: one of the request's on
 * that adapter, as the adapter finds it, or else its own (#305). A Model with no schema names no
 * adapter, so every one of the request's databases is a candidate.
 */
function databaseFor(named: SchemaAdapter | undefined): Promise<AnyDatabase> {
  const adapter = adapterFor(named);
  const all = requestStore()?.databases ?? [];
  const requested =
    named === undefined ? all : all.filter((db) => db[databaseExecutor].adapter === adapter);
  return adapter.databaseFor(named?.binding, requested);
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

/**
 * The Executor for `model`'s current database, found each time a query runs: where its statics
 * query, and where an association from a Model on another database finds its records (#228).
 */
export function currentExecutorOf(model: ModelClass): Executor {
  return currentExecutor(schemaAdapter(model));
}

/**
 * A Relation over all of `model`'s records, on the current database (`Product.all()`), or
 * without its default scopes (`Product.unscoped()`).
 */
export function currentRelation<C extends ModelClass>(
  model: C,
  options: { unscoped?: boolean } = {},
): Scoped<InstanceType<C>, ScopesOf<C>> {
  return relationFor(currentExecutorOf(model), model, options);
}
