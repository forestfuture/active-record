// Saving and destroying a record: validation, the callback order, and preparing the writes.
import { shownKey } from "./filtering.ts";
import { compileDelete, compileInsert, compileSelect, compileUpdate } from "./compiler.ts";
import { linkBefore, savingGroups } from "./autosave.ts";
import { assemble, prepareAfter, prepareBefore, validateAutosaves } from "./autosave-plan.ts";
import { noDependents, prepareDependents } from "./dependents.ts";
import { prepareReplacement, withRemoval } from "./has-one-replacement.ts";
import {
  CallbackAbort,
  RecordInvalid,
  RecordNotDestroyed,
  RecordNotFound,
  RecordNotSaved,
} from "./errors.ts";
import { clearErrors } from "./errors-collection.ts";
import {
  afterRollbackOf,
  runAfterCallbacks,
  runCallbacks,
  runCommitCallbacks,
} from "./callbacks.ts";
import { pinBefore } from "./executor.ts";
import { declared, type BeforeCallbackKind } from "./declarations.ts";
import { modelOf, type Model } from "./model.ts";
import { validateRequiredAssociations } from "./required-associations.ts";
import { Negated, type Condition } from "./query.ts";
import { linksOf, state } from "./record-state.ts";
import { column, sql } from "./sql.ts";
import { timestampsFor } from "./timestamps.ts";
import {
  combine,
  inGroup,
  runStages,
  stageOf,
  type PreparedWrite,
  type Stage,
} from "./unit-of-work.ts";
import { runValidations, type UniquenessOptions } from "./validations.ts";

/**
 * What a lifecycle run ended with. Refusals are outcomes (the non-throwing methods return
 * `false`, the `OrThrow` ones throw); constraint and D1 errors are thrown (ADR-0005).
 */
export type Outcome =
  | { status: "saved" }
  | { status: "invalid" }
  | { status: "aborted"; reason: string }
  | NotDestroyed;

/** A save refused because a record it destroys (marked for destruction, #37) refused its destroy. */
interface NotDestroyed {
  status: "notDestroyed";
  reason: string;
}

/** What a destroy lifecycle run ended with. */
export type DestroyOutcome =
  | { status: "destroyed" }
  | { status: "aborted"; reason: string }
  | { status: "restricted"; reason: string };

type Validity = "valid" | "invalid" | "aborted";

/**
 * Whether another row already has `value` for `attribute`: a `SELECT 1 … LIMIT 1` through the
 * record's own Database (so its Session), within the scope, leaving out the record's own row.
 */
async function isTaken(
  record: Model,
  attribute: string,
  value: unknown,
  { scope = [], caseSensitive = true }: UniquenessOptions,
): Promise<boolean> {
  const model = modelOf(record);
  const recordState = record[state];
  const conditions: Condition[] = [
    caseSensitive ? { [attribute]: value } : sql`lower(${column(attribute)}) = lower(${value})`,
    ...scope.map((name) => ({ [name]: recordState.read(name) })),
  ];
  if (!recordState.isNew) {
    recordState.requireKey("be checked for uniqueness");
    conditions.push(new Negated({ [model.primaryKey]: recordState.storedKeyValue }));
  }
  const { executor } = recordState;
  const query = compileSelect(executor.dialect, { model, conditions, order: [], limit: 1 }, "1");
  return (await executor.all(query)).length > 0;
}

/** Runs callbacks of `kind`; an `abort()` from one sets `abortReason` and returns `false`. */
async function runAbortableCallbacks(record: Model, kind: BeforeCallbackKind): Promise<boolean> {
  try {
    await runCallbacks(record, kind);
    return true;
  } catch (error) {
    if (!(error instanceof CallbackAbort)) throw error;
    record[state].abortReason = error.reason;
    return false;
  }
}

/** Whether the record is valid: `isValid()`'s answer. */
export async function validateRecord(record: Model): Promise<boolean> {
  return (await validation(record, new Set())) === "valid";
}

/**
 * Clears `errors` and `abortReason`, then beforeValidation → validators → afterValidation.
 * An `abort()` in either callback makes the record "aborted" (not valid).
 */
export async function validation(record: Model, claimed: Claimed): Promise<Validity> {
  const recordState = record[state];
  recordState.errors[clearErrors]();
  recordState.abortReason = undefined;
  if (!(await runAbortableCallbacks(record, "beforeValidation"))) return "aborted";
  await validateRequiredAssociations(record);
  await runValidations(declared(modelOf(record), "validations"), {
    record,
    read: (attribute) => recordState.read(attribute),
    errors: recordState.errors,
    isTaken: (attribute, value, options) => isTaken(record, attribute, value, options),
  });
  await validateAutosaves(record, claimed);
  if (!(await runAbortableCallbacks(record, "afterValidation"))) return "aborted";
  return recordState.errors.isEmpty() ? "valid" : "invalid";
}

/**
 * A prepared save or destroy, ready to write: stages written one after another, each as one
 * atomic batch. Its own `stages` are on its record's database, and there's more than one only
 * when autosaved records need a key D1 generates for their new owner, so they can't be written
 * in the same batch. Records on another database (#228) are separate writes on theirs: `before`
 * its stages (the new records it points at, its dependents), or `after` them (the records built
 * through it).
 */
export interface Ready {
  status: "ready";
  stages: Stage[];
  before: Stage[];
  after: Stage[];
}

/** A plan with nothing to write: its record is already part of the write. */
const nothing: Ready = { status: "ready", stages: [], before: [], after: [] };

/** A plan's stages in the order they're written. */
export function stagesOf({ before, stages, after }: Ready): Stage[] {
  return [...before, ...stages, ...after];
}

/** A save, prepared: every before-callback has run, autosaved records' included. */
export type SavePlan =
  | Ready
  | { status: "invalid" }
  | { status: "aborted"; reason: string }
  | NotDestroyed;

/** A destroy, prepared: `beforeDestroy` and its dependents' callbacks and checks have run. */
export type DestroyPlan =
  | Ready
  | { status: "aborted"; reason: string }
  | { status: "restricted"; reason: string };

/**
 * Records already part of the write being prepared, so a batch writes each record once: one
 * saved through its owner's autosave isn't saved again, nor is a record listed twice.
 */
export type Claimed = Set<Model>;

/** The error a refused save or destroy throws where there's no `false` to return. */
export function refusalError(
  record: Model,
  plan: Exclude<SavePlan | DestroyPlan, Ready>,
  kind: "save" | "destroy",
): Error {
  if (plan.status === "invalid") return new RecordInvalid(record);
  if (plan.status === "notDestroyed") return new RecordNotDestroyed(plan.reason);
  return kind === "save" ? new RecordNotSaved(plan.reason) : new RecordNotDestroyed(plan.reason);
}

function aborted(record: Model): { status: "aborted"; reason: string } {
  return { status: "aborted", reason: record[state].abortReason ?? "" };
}

/**
 * The save lifecycle, in the contract's order:
 * can this record be used → beforeValidation → validators → afterValidation
 * → beforeSave → beforeCreate | beforeUpdate → write (skipped when clean) → commit state
 * → afterCreate | afterUpdate → afterSave.
 */
export async function saveLifecycle(record: Model): Promise<Outcome> {
  const needs = "save() needs its records";
  // Each database's records pinned to it before anything runs (#93), and each one's again
  // before anything is written, with any a callback added.
  for (const { records } of savingGroups(record)) await pinBefore(linksOf(records), needs);
  const plan = await prepareSave(record, new Set());
  if (plan.status !== "ready") return plan;
  await runStages(stagesOf(plan), needs);
  return { status: "saved" };
}

/** Everything a save does before writing: validation and the before-callbacks. */
export async function prepareSave(record: Model, claimed: Claimed): Promise<SavePlan> {
  if (claimed.has(record)) return nothing;
  const recordState = record[state];
  recordState.requireLive("be saved");
  const validity = await validation(record, claimed);
  if (validity === "invalid") return { status: "invalid" };
  if (validity === "aborted") return aborted(record);
  return prepareWrites(record, claimed);
}

/**
 * A validated record's before-callbacks and writes, then its autosaved records' (and theirs,
 * at every level). If the owner's key is known, its records join its batch; if D1 generates
 * it, they follow in the next one, once the owner is written.
 */
export async function prepareWrites(record: Model, claimed: Claimed): Promise<SavePlan> {
  claimed.add(record);
  // New belongsTo records first: the record needs their keys (Rails' belongs_to autosave).
  const before = await prepareBefore(record, claimed);
  if ("status" in before) return before;
  const isInsert = record[state].isNew;
  if (!(await beforeWrite(record, isInsert))) return aborted(record);
  // A hasOne's new record removes the one it replaces in its own batch (#40).
  const removal = await prepareReplacement(record, claimed);
  const own = stageOf(record, [record], () => {
    linkBefore(record, before.pointedAt);
    return [saveWrite(record, isInsert)];
  });
  const after = await prepareAfter(record, claimed);
  if (!Array.isArray(after)) return after;
  return withRemoval(assemble(record, own, before, after), removal, record);
}

/** beforeSave, then beforeCreate or beforeUpdate; `false` if one aborted. */
async function beforeWrite(record: Model, isInsert: boolean): Promise<boolean> {
  return (
    (await runAbortableCallbacks(record, "beforeSave")) &&
    (await runAbortableCallbacks(record, isInsert ? "beforeCreate" : "beforeUpdate"))
  );
}

/**
 * A save's write: INSERT the assigned attributes (`RETURNING *` loads what D1 stored), or
 * UPDATE the changed ones, plus timestamps; a clean record sends nothing. Its after-callbacks
 * are afterCreate or afterUpdate, then afterSave.
 */
function saveWrite(record: Model, isInsert: boolean): PreparedWrite {
  const recordState = record[state];
  const model = modelOf(record);
  const after = async () => {
    await runAfterCallbacks(record, isInsert ? "afterCreate" : "afterUpdate", "save");
    await runAfterCallbacks(record, "afterSave", "save");
  };
  const afterRollback = afterRollbackOf(record);
  const afterCommit = () => runCommitCallbacks(record, isInsert ? "create" : "update");
  if (isInsert) {
    const own = recordState.insertAssignments();
    const insert = compileInsert(model, [...own, ...timestampsFor(model, "insert", own)]);
    return {
      statements: [insert],
      commit: ([result]) => recordState.commitInsert(result?.rows[0]),
      after,
      afterCommit,
      afterRollback,
    };
  }
  const own = recordState.updateAssignments();
  if (own.length === 0) {
    const commit = () => recordState.commitClean();
    return { statements: [], commit, after, afterCommit, afterRollback };
  }
  const stamps = timestampsFor(model, "update", own);
  return {
    statements: [compileUpdate(model, [...own, ...stamps], recordState.storedKey)],
    commit: () => recordState.commitUpdate(stamps),
    after,
    afterCommit,
    afterRollback,
  };
}

/**
 * The destroy lifecycle: can this record be used → beforeDestroy → its `dependent:` strategies
 * → DELETE by the stored key (skipped for a never-saved record: there's no row, as in Rails)
 * → mark destroyed → afterDestroy. Every write, dependents' included, is one atomic batch.
 */
export async function destroyLifecycle(record: Model): Promise<DestroyOutcome> {
  const needs = "destroy() needs its records";
  await pinBefore(linksOf([record]), needs);
  const plan = await prepareDestroy(record, new Set());
  if (plan.status !== "ready") return plan;
  await runStages(stagesOf(plan), needs);
  return { status: "destroyed" };
}

/** Everything a destroy does before writing: beforeDestroy, then its dependents' plans. */
export async function prepareDestroy(record: Model, claimed: Claimed): Promise<DestroyPlan> {
  if (claimed.has(record)) return nothing;
  claimed.add(record);
  const recordState = record[state];
  recordState.requireLive("be destroyed");
  recordState.abortReason = undefined;
  if (!(await runAbortableCallbacks(record, "beforeDestroy"))) return aborted(record);
  const dependents = recordState.isNew ? noDependents : await prepareDependents(record, claimed);
  if (dependents.status !== "ready") return dependents;
  // A record that was never saved has no row, so no DELETE and no commit callbacks, as in Rails.
  const hasRow = !recordState.isNew;
  const deletion = hasRow ? [compileDelete(modelOf(record), recordState.storedKey)] : [];
  const own = stageOf(record, [record], () => [
    {
      statements: deletion,
      commit: () => recordState.markDestroyed(),
      after: () => runAfterCallbacks(record, "afterDestroy", "destroy"),
      afterRollback: afterRollbackOf(record),
      ...(hasRow && { afterCommit: () => runCommitCallbacks(record, "destroy") }),
    },
  ]);
  // Dependents first: their records go before the owner's row, which they may point at. Those
  // on another database (#228) are written there, before it.
  const stages = inGroup(combine([[dependents.here], [own]]), record);
  return { status: "ready", stages, before: dependents.elsewhere, after: [] };
}

/** Loads the record's row again by its stored primary key, discarding unsaved changes. */
export async function reloadRecord(record: Model): Promise<void> {
  const recordState = record[state];
  recordState.requireLive("be reloaded");
  const { executor } = recordState;
  const model = modelOf(record);
  if (recordState.isNew) {
    throw new RecordNotFound(
      `${model.name} record hasn't been saved, so there's nothing to reload`,
    );
  }
  const key = recordState.storedKeyValue;
  const query = { model, conditions: [{ [model.primaryKey]: key }], order: [], limit: 1 };
  const [row] = await executor.all(compileSelect(executor.dialect, query));
  if (row === undefined) {
    throw new RecordNotFound(
      `${model.name} with ${model.primaryKey} ${shownKey(model, key)} not found`,
    );
  }
  recordState.clearAssociations();
  recordState.markedForDestruction = false;
  recordState.loadRow(row);
}
