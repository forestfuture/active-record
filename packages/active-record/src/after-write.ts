// What runs once a record's write is kept: its after-callbacks, then its commit callbacks (`afterCommit`, …).
import {
  declared,
  type AfterCallbackKind,
  type CallbackKind,
  type CommitAction,
} from "./declarations.ts";
import { AbortAfterPersistence, CallbackAbort } from "./errors.ts";
import { modelOf, type Model } from "./model.ts";

/** Runs the Model's callbacks of `kind` in declaration order, awaiting each. */
export async function runCallbacks(record: Model, kind: CallbackKind): Promise<void> {
  for (const callback of declared(modelOf(record), kind)) {
    await callback(record);
  }
}

/**
 * Runs after-write callbacks. The write already succeeded, so an `abort()` here can't refuse
 * anything: it becomes `AbortAfterPersistence`. Any other error propagates unchanged.
 */
export async function runAfterCallbacks(
  record: Model,
  kind: AfterCallbackKind,
  lifecycle: "save" | "destroy",
): Promise<void> {
  try {
    await runCallbacks(record, kind);
  } catch (error) {
    if (error instanceof CallbackAbort) throw new AbortAfterPersistence(kind, lifecycle, error);
    throw error;
  }
}

/** A write's rollback callbacks: the record's `afterRollback`, to run if the database refuses it. */
export function rollbackOf(record: Model): () => Promise<void> {
  return () => runCallbacks(record, "afterRollback");
}

/**
 * Runs the record's commit callbacks for `action`, in the order they were declared. The write is
 * already kept, so an `abort()` in one is `AbortAfterPersistence`; any other error propagates.
 */
export async function runCommitCallbacks(record: Model, action: CommitAction): Promise<void> {
  for (const { kind, on, callback } of declared(modelOf(record), "commitCallbacks")) {
    if (!on.includes(action)) continue;
    try {
      await callback(record);
    } catch (error) {
      if (!(error instanceof CallbackAbort)) throw error;
      throw new AbortAfterPersistence(kind, action === "destroy" ? "destroy" : "save", error);
    }
  }
}
