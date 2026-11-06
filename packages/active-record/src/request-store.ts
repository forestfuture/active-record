// The request's AsyncLocalStorage: the databases `withDatabase` set, and what each one's driver holds for its scope. Loaded when it's first needed (ADR-0012).
import type { AnyDatabase } from "./database.ts";
import { NoDatabase } from "./errors.ts";
import type { DatabaseExecutor } from "./executor.ts";

/** A database's scope in one `withDatabase` call (a Database scope). */
export interface DatabaseScope {
  /** What its driver opened for it (pg-record: the scope's client), handed to each statement. */
  readonly held: unknown;
  /** Whether its call has returned: a call nested in it after that opens its own. */
  hasEnded: boolean;
}

/** What `withDatabase` keeps for the code it runs. */
export interface RequestStore {
  /** The request's databases, the innermost scope's first. */
  databases: readonly AnyDatabase[];
  /** Each database's scope. A call nested in a running one with the same database shares it. */
  scopes: ReadonlyMap<DatabaseExecutor, DatabaseScope>;
}

interface Storage<T> {
  getStore(): T | undefined;
  run<R>(store: T, fn: () => R): R;
}

/** The storage, once `withDatabase` has been called. */
let storage: Storage<RequestStore> | undefined;

/** Node's AsyncLocalStorage, loaded when it's first needed, so Workers without Node.js compatibility still build. */
function newStorage(): Storage<RequestStore> {
  const process = (globalThis as { process?: { getBuiltinModule?(id: string): unknown } }).process;
  const hooks = process?.getBuiltinModule?.("node:async_hooks") as
    | { AsyncLocalStorage: new () => Storage<RequestStore> }
    | undefined;
  if (hooks === undefined) {
    throw new NoDatabase(
      "withDatabase needs Node.js compatibility: a compatibility_date of 2026-08-04 or later, " +
        "or the nodejs_compat flag, in your Wrangler config",
    );
  }
  return new hooks.AsyncLocalStorage();
}

/** What the current `withDatabase` keeps, if code runs inside one. */
export function requestStore(): RequestStore | undefined {
  return storage?.getStore();
}

/** Runs `fn` with `store` as the request's. */
export function runWithStore<R>(store: RequestStore, fn: () => R): R {
  storage ??= newStorage();
  return storage.run(store, fn);
}
