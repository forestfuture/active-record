// `noTouching` (#496): the Models whose records aren't touched inside a block, held in an AsyncLocalStorage of its own (ADR-0012), and asking whether a block covers a record's Model.
import { newAsyncStorage, NODE_COMPATIBILITY, type Storage } from "./async-storage.ts";
import { ActiveRecordError } from "./errors.ts";
import type { AbstractModelClass } from "./model.ts";

/** The Models the running `noTouching` blocks were called on, the outermost block's first. */
type CoveredModels = readonly AbstractModelClass[];

/** The storage, once `noTouching` has been called. */
let storage: Storage<CoveredModels> | undefined;

/**
 * Runs `fn` with `model`'s records not touched, nor those of the Models extending it, added to
 * those an outer block covers, for the code it runs and everything it awaits.
 */
export async function noTouching<R>(
  model: AbstractModelClass,
  fn: () => R | Promise<R>,
): Promise<R> {
  storage ??= newAsyncStorage<CoveredModels>();
  if (storage === undefined) {
    throw new ActiveRecordError(`noTouching needs Node.js compatibility: ${NODE_COMPATIBILITY}`);
  }
  const outer = storage.getStore() ?? [];
  return await storage.run([...outer, model], fn);
}

/** Whether a `noTouching` block the code runs in covers `model`: its own Model's, or one it extends. */
export function isCoveredByNoTouching(model: AbstractModelClass): boolean {
  const covered = storage?.getStore() ?? [];
  return covered.some((each) => each === model || model.prototype instanceof each);
}
