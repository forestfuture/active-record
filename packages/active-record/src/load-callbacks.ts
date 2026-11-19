// `afterFind` and `afterInitialize` (#49): the callbacks a record runs, synchronously, as it's loaded from a row or built.
import { declared, type LoadCallbackKind } from "./declarations.ts";
import { modelOf, type Model } from "./model.ts";

/** Runs a record's `afterFind`, then its `afterInitialize`: it was just loaded from a row. */
export function runFindCallbacks(record: Model): void {
  runLoadCallbacks(record, "afterFind");
  runLoadCallbacks(record, "afterInitialize");
}

/** Runs a record's `afterInitialize`: it was just built, and handed to any `init`. */
export function runInitializeCallbacks(record: Model): void {
  runLoadCallbacks(record, "afterInitialize");
}

/** Runs the Model's callbacks of `kind` in declaration order; none may return a promise. */
function runLoadCallbacks(record: Model, kind: LoadCallbackKind): void {
  const model = modelOf(record);
  for (const callback of declared(model, kind)) {
    refuseThenable(
      callback(record),
      `${model.name}.${kind}: a callback returned a promise, which nothing awaits; ${kind} runs synchronously`,
    );
  }
}

/**
 * Throws `TypeError` with `message` if `result` is a promise or another thenable, which the code
 * that ran it can't await. Its rejection, if it has one, is handled here, so the `TypeError` is
 * the only error.
 */
export function refuseThenable(result: unknown, message: string): void {
  if (!isThenable(result)) return;
  void Promise.resolve(result).catch(() => {});
  throw new TypeError(message);
}

function isThenable(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof value.then === "function"
  );
}
