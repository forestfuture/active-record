// `noTouching` (#496): the Models whose records aren't touched inside a block, held in an AsyncLocalStorage of its own (ADR-0012), and asking whether a record's Model is one.
import { ActiveRecordError } from "./errors.ts";
import { newAsyncStorage, NODE_COMPATIBILITY, type Storage } from "./request-store.ts";

/** The Models whose touches are off, the outermost block's first. */
type TurnedOff = readonly (abstract new (...args: never) => object)[];

/** The storage, once `noTouching` has been called. */
let storage: Storage<TurnedOff> | undefined;

/**
 * Runs `fn` with `model`'s touches off, and those of the Models extending it, added to those an
 * outer block turned off, for the code it runs and everything it awaits.
 */
export async function noTouching<R>(
  model: TurnedOff[number],
  fn: () => R | Promise<R>,
): Promise<R> {
  storage ??= newAsyncStorage<TurnedOff>();
  if (storage === undefined) {
    throw new ActiveRecordError(`noTouching needs Node.js compatibility: ${NODE_COMPATIBILITY}`);
  }
  const outer = storage.getStore() ?? [];
  return await storage.run([...outer, model], fn);
}

/** Whether a `noTouching` block the code runs in turned off touching `model`'s records. */
export function isTouchingOff(model: TurnedOff[number]): boolean {
  const off = storage?.getStore() ?? [];
  return off.some((each) => each === model || model.prototype instanceof each);
}
