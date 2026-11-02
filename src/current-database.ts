// `withDatabase`, and where a query from a Model's statics (`Product.find(id)`) finds its database:
// the request's, set with `withDatabase`, or else whatever its adapter finds (#77). Nothing
// per-request is ever stored on a class (ADR-0003): a request's database lives only in its
// AsyncLocalStorage.
import { schemaBinding } from "./generated-model.ts";
import type { Adapter } from "./adapter.ts";
import { d1Adapter } from "./d1/adapter.ts";
import { databaseParts, type AnyDatabase } from "./database.ts";
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
 * Usually called once per request, in middleware. Nested calls add to the outer ones.
 */
export async function withDatabase<R>(
  databases: AnyDatabase | readonly AnyDatabase[],
  fn: () => R | Promise<R>,
): Promise<R> {
  requests ??= newStorage();
  const outer = requests.getStore() ?? [];
  const inner = Array.isArray(databases) ? databases : [databases as AnyDatabase];
  for (const db of inner) db[databaseParts].executor.setOrigin("request");
  return requests.run([...inner, ...outer], fn);
}

/**
 * The adapter a statement on binding `name` compiles for. Statements compile when they're built,
 * before their database is found, so this can't wait to find it: a generated Model's adapter,
 * which is D1's until the schema names one (#268), or else the request's database's.
 */
function adapterFor(name: string | undefined): Adapter {
  if (name !== undefined) return d1Adapter;
  const [first] = requests?.getStore() ?? [];
  return first?.[databaseParts].executor.adapter ?? d1Adapter;
}

/** The database a query on binding `name` uses now. */
function databaseFor(name: string | undefined): Promise<AnyDatabase> {
  return adapterFor(name).databaseFor(name, requests?.getStore() ?? []);
}

/**
 * One Executor per binding name (from a Model's schema), finding the current database each
 * time a query runs; Models on one binding share it, so their statements can share a batch.
 */
const executors = new Map<string | undefined, Executor>();

/** The Executor for queries started from a Model on binding `name`. */
function currentExecutor(name: string | undefined): Executor {
  let executor = executors.get(name);
  if (executor === undefined) {
    executor = new CurrentExecutor(
      () => adapterFor(name),
      async () => (await databaseFor(name))[databaseParts].executor,
    );
    executors.set(name, executor);
  }
  return executor;
}

/** A Relation over all of `model`'s records, on the current database (`Product.all()`). */
export function currentRelation<C extends ModelClass>(
  model: C,
): Scoped<InstanceType<C>, ScopesOf<C>> {
  return relationFor(currentExecutor(schemaBinding(model)), model);
}
