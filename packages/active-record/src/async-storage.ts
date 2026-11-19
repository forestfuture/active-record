// Making an AsyncLocalStorage, from Node's, loaded when it's first needed so Workers without Node.js compatibility still build (ADR-0012): `withDatabase`'s and `noTouching`'s (#496).

/** An AsyncLocalStorage: what code run inside `run` (and everything it awaits) reads. */
export interface Storage<T> {
  getStore(): T | undefined;
  run<R>(store: T, fn: () => R): R;
}

/** The Wrangler settings that give a Worker Node.js compatibility, for the errors that need it. */
export const NODE_COMPATIBILITY =
  "a compatibility_date of 2026-08-04 or later, or the nodejs_compat flag, in your Wrangler config";

/** A new AsyncLocalStorage, or `undefined` without Node.js compatibility. */
export function newAsyncStorage<T>(): Storage<T> | undefined {
  const process = (globalThis as { process?: { getBuiltinModule?(id: string): unknown } }).process;
  const hooks = process?.getBuiltinModule?.("node:async_hooks") as
    | { AsyncLocalStorage: new () => Storage<T> }
    | undefined;
  return hooks === undefined ? undefined : new hooks.AsyncLocalStorage();
}
