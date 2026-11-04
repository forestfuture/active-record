// Saving and destroying a record: validation, the callback order, and preparing the writes.
import { shownKey } from "./filtering.ts";
import { compileDelete, compileInsert, compileSelect, compileUpdate } from "./compiler.ts";
import {
  autosavesOf,
  linkBelongsTo,
  linkRecords,
  ownerKeysKnown,
  belongsToKeysKnown,
  belongsToAutosavesOf,
  unsavedBelongsTo,
  type Autosave,
} from "./autosave.ts";
import { prepareDependents } from "./dependents.ts";
import {
  AbortAfterPersistence,
  CallbackAbort,
  RecordInvalid,
  RecordNotDestroyed,
  RecordNotFound,
  RecordNotSaved,
} from "./errors.ts";
import { clearErrors } from "./errors-collection.ts";
import { type Executor, pinBefore, pinClaimed } from "./executor.ts";
import {
  declared,
  type AfterCallbackKind,
  type BeforeCallbackKind,
  type CallbackKind,
} from "./declarations.ts";
import { modelOf, type Model } from "./model.ts";
import { Negated, type Condition } from "./query.ts";
import { linksOf, state } from "./record-state.ts";
import { column, sql } from "./sql.ts";
import { timestampsFor } from "./timestamps.ts";
import { runAfter, writeAll, type PreparedWrite } from "./unit-of-work.ts";
import { runValidations, type UniquenessOptions } from "./validations.ts";

/**
 * What a lifecycle run ended with. Refusals are outcomes (the non-throwing methods return
 * `false`, the `OrThrow` ones throw); constraint and D1 errors are thrown (ADR-0005).
 */
export type Outcome =
  | { status: "saved" }
  | { status: "invalid" }
  | { status: "aborted"; reason: string };

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

/** Runs the Model's callbacks of `kind` in declaration order, awaiting each. */
async function runCallbacks(record: Model, kind: CallbackKind): Promise<void> {
  for (const callback of declared(modelOf(record), kind)) {
    await callback(record);
  }
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
async function validation(record: Model, claimed: Claimed): Promise<Validity> {
  const recordState = record[state];
  recordState.errors[clearErrors]();
  recordState.abortReason = undefined;
  if (!(await runAbortableCallbacks(record, "beforeValidation"))) return "aborted";
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

/** One batch of a plan: its writes, built when it runs so foreign keys can be linked first. */
type Stage = () => PreparedWrite[];

/**
 * A prepared save or destroy, ready to write: stages written one after another, each as one
 * atomic batch. There's more than one only when autosaved records need a key D1 generates for
 * their new owner, so they can't be written in the same batch.
 */
export interface Ready {
  status: "ready";
  stages: Stage[];
}

/** A save, prepared: every before-callback has run, autosaved records' included. */
export type SavePlan = Ready | { status: "invalid" } | { status: "aborted"; reason: string };

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
  return kind === "save" ? new RecordNotSaved(plan.reason) : new RecordNotDestroyed(plan.reason);
}

function aborted(record: Model): { status: "aborted"; reason: string } {
  return { status: "aborted", reason: record[state].abortReason ?? "" };
}

/**
 * New records built through the record's hasMany associations are validated with it, one
 * after another, as Rails' `validate: true` does: an invalid one adds "is invalid" to the
 * association's name.
 */
async function validateAutosaves(record: Model, claimed: Claimed): Promise<void> {
  for (const { association, record: pointedAt } of belongsToAutosavesOf(record)) {
    const { name } = association;
    if (!pointedAt[state].isNew || claimed.has(pointedAt)) continue;
    if ((await validation(pointedAt, claimed)) !== "valid") {
      record[state].errors.add(name, { type: "invalid" });
    }
  }
  for (const { association, records } of autosavesOf(record, claimed)) {
    const { name } = association;
    let valid = true;
    for (const each of records) {
      if ((await validation(each, claimed)) !== "valid") valid = false;
    }
    if (!valid) record[state].errors.add(name, { type: "invalid" });
  }
}

/**
 * The save lifecycle, in the contract's order:
 * can this record be used → beforeValidation → validators → afterValidation
 * → beforeSave → beforeCreate | beforeUpdate → write (skipped when clean) → commit state
 * → afterCreate | afterUpdate → afterSave.
 */
export async function saveLifecycle(record: Model): Promise<Outcome> {
  const database = await pinBefore(linksOf(recordsSaving(record)), "save() needs its records");
  const claimed: Claimed = new Set();
  const plan = await prepareSave(record, claimed);
  if (plan.status !== "ready") return plan;
  await pinClaimed(linksOf(claimed), database, "save() needs its records");
  await runPlan(database, plan);
  return { status: "saved" };
}

/**
 * The records saving `record` would write: it, the new records it points at through belongsTo,
 * and the new records built through its associations, at every level. Found without running
 * any validation or callback, so a save can be checked before anything runs (#93).
 */
export function recordsSaving(record: Model): Model[] {
  const found = new Set<Model>();
  const visit = (each: Model): void => {
    if (found.has(each)) return;
    found.add(each);
    for (const { record: target } of belongsToAutosavesOf(each)) {
      if (target[state].isNew) visit(target);
    }
    for (const { records } of autosavesOf(each, found)) records.forEach(visit);
  };
  visit(record);
  return [...found];
}

/** Everything a save does before writing: validation and the before-callbacks. */
export async function prepareSave(record: Model, claimed: Claimed): Promise<SavePlan> {
  if (claimed.has(record)) return { status: "ready", stages: [] };
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
async function prepareWrites(record: Model, claimed: Claimed): Promise<SavePlan> {
  claimed.add(record);
  // New belongsTo records first: the record needs their keys (Rails' belongs_to autosave).
  const pointedAt = belongsToAutosavesOf(record);
  const firstPlans = await prepareEach(unsavedBelongsTo(pointedAt, claimed), claimed);
  if (!Array.isArray(firstPlans)) return firstPlans;
  const isInsert = record[state].isNew;
  if (!(await beforeWrite(record, isInsert))) return aborted(record);
  const own: Stage = () => {
    linkBelongsTo(record, pointedAt);
    return [saveWrite(record, isInsert)];
  };
  const autosaves = autosavesOf(record, claimed);
  const childPlans = await prepareEach(
    autosaves.flatMap(({ records }) => records),
    claimed,
  );
  if (!Array.isArray(childPlans)) return childPlans;
  const stages = withChildren(record, own, autosaves, childPlans);
  if (firstPlans.length === 0) return { status: "ready", stages };
  const first = combine(firstPlans.map((plan) => plan.stages));
  return {
    status: "ready",
    stages: belongsToKeysKnown(pointedAt) ? combine([first, stages]) : [...first, ...stages],
  };
}

/** Each record's prepared writes, in order; the first refusal stops them. */
async function prepareEach(
  records: readonly Model[],
  claimed: Claimed,
): Promise<Ready[] | Exclude<SavePlan, Ready>> {
  const plans: Ready[] = [];
  for (const each of records) {
    const plan = await prepareWrites(each, claimed);
    if (plan.status !== "ready") return plan;
    plans.push(plan);
  }
  return plans;
}

/**
 * The owner's stage with its autosaved records': in the same batch when the owner's key is
 * known, else in the next one. The records are linked to the owner just before their first
 * stage builds its statements.
 */
function withChildren(
  owner: Model,
  own: Stage,
  autosaves: readonly Autosave[],
  plans: readonly Ready[],
): Stage[] {
  if (plans.length === 0) return [own];
  const [first, ...rest] = combine(plans.map(({ stages }) => stages));
  const linked: Stage[] = [() => (linkRecords(owner, autosaves), first!()), ...rest];
  return ownerKeysKnown(owner, autosaves) ? combine([[own], linked]) : [own, ...linked];
}

/** Stage lists merged position by position: every plan's first stage in one batch, and so on. */
function combine(stageLists: readonly (readonly Stage[])[]): Stage[] {
  const length = Math.max(...stageLists.map((stages) => stages.length));
  return Array.from(
    { length },
    (_, index) => () => stageLists.flatMap((stages) => stages[index]?.() ?? []),
  );
}

/**
 * Writes a plan's stages one after another, each as one atomic batch, then runs the written
 * writes' after-callbacks in order. If a later stage fails, the earlier ones stay written, so
 * their after-callbacks still run before the error is thrown.
 */
async function runPlan(executor: Executor, plan: Ready): Promise<void> {
  const written: PreparedWrite[] = [];
  let failure: { error: unknown } | undefined;
  try {
    for (const stage of plan.stages) {
      const writes = stage();
      await writeAll(executor, writes);
      written.push(...writes);
    }
  } catch (error) {
    failure = { error };
  }
  await runAfter(written);
  if (failure !== undefined) throw failure.error;
}

/**
 * Runs after-write callbacks. The write already succeeded, so an `abort()` here can't refuse
 * anything: it becomes `AbortAfterPersistence`. Any other error propagates unchanged.
 */
async function runAfterCallbacks(
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
  if (isInsert) {
    const own = recordState.insertAssignments();
    const insert = compileInsert(model, [...own, ...timestampsFor(model, "insert", own)]);
    return {
      statements: [insert],
      commit: ([result]) => recordState.commitInsert(result?.rows[0]),
      after,
    };
  }
  const own = recordState.updateAssignments();
  if (own.length === 0) return { statements: [], commit: () => recordState.commitClean(), after };
  const stamps = timestampsFor(model, "update", own);
  return {
    statements: [compileUpdate(model, [...own, ...stamps], recordState.storedKey)],
    commit: () => recordState.commitUpdate(stamps),
    after,
  };
}

/**
 * The destroy lifecycle: can this record be used → beforeDestroy → its `dependent:` strategies
 * → DELETE by the stored key (skipped for a never-saved record: there's no row, as in Rails)
 * → mark destroyed → afterDestroy. Every write, dependents' included, is one atomic batch.
 */
export async function destroyLifecycle(record: Model): Promise<DestroyOutcome> {
  const database = await pinBefore(linksOf([record]), "destroy() needs its records");
  const claimed: Claimed = new Set();
  const plan = await prepareDestroy(record, claimed);
  if (plan.status !== "ready") return plan;
  await pinClaimed(linksOf(claimed), database, "destroy() needs its records");
  await runPlan(database, plan);
  return { status: "destroyed" };
}

/** Everything a destroy does before writing: beforeDestroy, then its dependents' plans. */
export async function prepareDestroy(record: Model, claimed: Claimed): Promise<DestroyPlan> {
  if (claimed.has(record)) return { status: "ready", stages: [] };
  claimed.add(record);
  const recordState = record[state];
  recordState.requireLive("be destroyed");
  recordState.abortReason = undefined;
  if (!(await runAbortableCallbacks(record, "beforeDestroy"))) return aborted(record);
  const dependents = recordState.isNew
    ? { status: "ready" as const, writes: () => [] }
    : await prepareDependents(record, claimed);
  if (dependents.status !== "ready") return dependents;
  const deletion = recordState.isNew ? [] : [compileDelete(modelOf(record), recordState.storedKey)];
  // Dependents first: their records go before the owner's row, which they may point at.
  const stage: Stage = () => [
    ...dependents.writes(),
    {
      statements: deletion,
      commit: () => recordState.markDestroyed(),
      after: () => runAfterCallbacks(record, "afterDestroy", "destroy"),
    },
  ];
  return { status: "ready", stages: [stage] };
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
  recordState.loadRow(row);
}
