// Running a record's callbacks: each kind's in declaration order, and those a write runs once it's kept (after-callbacks, then commit callbacks) or refused (`afterRollback`).
import {
  declared,
  type AfterCallbackKind,
  type CallbackKind,
  type CommitAction,
  type CommitCallbackKind,
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
 * Runs `run`, a callback of `kind` that runs once the write is kept. An `abort()` there can't
 * refuse anything: it becomes `AbortAfterPersistence`. Any other error propagates unchanged.
 */
async function tooLateToAbort(
  run: () => unknown,
  kind: AfterCallbackKind | CommitCallbackKind,
  lifecycle: "save" | "destroy",
): Promise<void> {
  try {
    await run();
  } catch (error) {
    if (error instanceof CallbackAbort) throw new AbortAfterPersistence(kind, lifecycle, error);
    throw error;
  }
}

/** Runs after-write callbacks; an `abort()` in one is `AbortAfterPersistence`. */
export async function runAfterCallbacks(
  record: Model,
  kind: AfterCallbackKind,
  lifecycle: "save" | "destroy",
): Promise<void> {
  await tooLateToAbort(() => runCallbacks(record, kind), kind, lifecycle);
}

/** A write's rollback callbacks: the record's `afterRollback`, to run if the database refuses it. */
export function afterRollbackOf(record: Model): () => Promise<void> {
  return () => runCallbacks(record, "afterRollback");
}

/**
 * Runs the record's commit callbacks for `action`, in the order they were declared. The write is
 * already kept, so an `abort()` in one is `AbortAfterPersistence`; any other error propagates.
 */
export async function runCommitCallbacks(record: Model, action: CommitAction): Promise<void> {
  for (const { kind, on, callback } of declared(modelOf(record), "commitCallbacks")) {
    if (!on.includes(action)) continue;
    const lifecycle = action === "destroy" ? "destroy" : "save";
    await tooLateToAbort(() => callback(record), kind, lifecycle);
  }
}
