// `afterFind` and `afterInitialize` (#49): the callbacks a record runs, synchronously, as it's loaded from a row or built.
import { declared, type SyncCallbackKind } from "./declarations.ts";
import { modelOf, type Model } from "./model.ts";
import { refuseThenable } from "./thenables.ts";

/** Runs a record's `afterFind`, then its `afterInitialize`: it was just loaded from a row. */
export function runLoadedCallbacks(record: Model): void {
  runSyncCallbacks(record, "afterFind");
  runSyncCallbacks(record, "afterInitialize");
}

/** Runs a record's `afterInitialize`: it was just built, and handed to any `init`. */
export function runBuiltCallbacks(record: Model): void {
  runSyncCallbacks(record, "afterInitialize");
}

/** Runs the Model's callbacks of `kind` in declaration order; none may return a promise. */
function runSyncCallbacks(record: Model, kind: SyncCallbackKind): void {
  const model = modelOf(record);
  for (const callback of declared(model, kind)) {
    refuseThenable(
      callback(record),
      `${model.name}.${kind}: a callback returned a promise, which nothing awaits; ${kind} runs synchronously`,
    );
  }
}
