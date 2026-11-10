// Saving and destroying a record: validation, the callback order, and preparing the writes.
import { shownKey } from "./filtering.ts";
import { compileDelete, compileInsert, compileSelect, compileUpdate } from "./compiler.ts";
import {
  autosavesOf,
  linkBelongsTo,
  linkRecords,
  linkedRecords,
  ownerKeysKnown,
  belongsToKeysKnown,
  belongsToAutosavesOf,
  savingGroups,
  unsavedBelongsTo,
  type Autosave,
  type BelongsToAutosave,
  type Linked,
} from "./autosave.ts";
import { noDependents, prepareDependents } from "./dependents.ts";
import {
  AbortAfterPersistence,
  CallbackAbort,
  RecordInvalid,
  RecordNotDestroyed,
  RecordNotFound,
  RecordNotSaved,
} from "./errors.ts";
import { clearErrors } from "./errors-collection.ts";
import { pinBefore } from "./executor.ts";
import {
  declared,
  type AfterCallbackKind,
  type BeforeCallbackKind,
  type CallbackKind,
} from "./declarations.ts";
import { modelOf, type Model } from "./model.ts";
import { Negated, type Condition } from "./query.ts";
import { linksOf, state } from "./record-state.ts";
import type { ResolvedAssociation } from "./resolved-association.ts";
import { column, sql } from "./sql.ts";
import { timestampsFor } from "./timestamps.ts";
import {
  afterLinking,
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
async function prepareWrites(record: Model, claimed: Claimed): Promise<SavePlan> {
  claimed.add(record);
  // New belongsTo records first: the record needs their keys (Rails' belongs_to autosave).
  const pointedAt = belongsToAutosavesOf(record);
  const first = await prepareEach(unsavedBelongsTo(pointedAt, claimed), claimed);
  if (!Array.isArray(first)) return first;
  const isInsert = record[state].isNew;
  if (!(await beforeWrite(record, isInsert))) return aborted(record);
  const own = stageOf(record, [record], () => {
    linkBelongsTo(record, pointedAt);
    return [saveWrite(record, isInsert)];
  });
  const autosaves = autosavesOf(record, claimed);
  const children = await prepareEach(linkedRecords(autosaves), claimed);
  if (!Array.isArray(children)) return children;
  return assemble({ record, own, pointedAt, first, autosaves, children });
}

/** A record's prepared writes, and the association its owner writes it through. */
interface Planned {
  association: ResolvedAssociation;
  plan: Ready;
}

/** Each record's prepared writes, in order; the first refusal stops them. */
async function prepareEach(
  records: readonly Linked[],
  claimed: Claimed,
): Promise<Planned[] | Exclude<SavePlan, Ready>> {
  const plans: Planned[] = [];
  for (const { association, record } of records) {
    const plan = await prepareWrites(record, claimed);
    if (plan.status !== "ready") return plan;
    plans.push({ association, plan });
  }
  return plans;
}

/** What a record's save plan is made of: its own stage, and its autosaved records' plans. */
interface Parts {
  record: Model;
  own: Stage;
  pointedAt: readonly BelongsToAutosave[];
  first: readonly Planned[];
  autosaves: readonly Autosave[];
  children: readonly Planned[];
}

/**
 * A record's save plan. The records it autosaves on its database join its stages: the new
 * records it points at in its batch when their keys are known, else in the one before; those
 * built through it as `withChildren` says. Those on another database (#228) are written there
 * separately, as Rails does, by the association: the ones it points at before it, and the ones
 * built through it after it.
 */
function assemble(parts: Parts): Ready {
  const { record, own } = parts;
  const here = <T extends { association: ResolvedAssociation }>(each: T) =>
    !each.association.crossesDatabases;
  const first = parts.first.filter(here);
  const autosaves = parts.autosaves.filter(here);
  const children = parts.children.filter(here);
  let stages = withChildren(record, own, autosaves, children);
  if (first.length > 0) {
    const firstStages = combine(first.map(({ plan }) => plan.stages));
    const known = belongsToKeysKnown(parts.pointedAt.filter(here));
    stages = known ? combine([firstStages, stages]) : [...firstStages, ...stages];
  }
  const nested = [...first, ...children].map(({ plan }) => plan);
  const elsewhere = (planned: readonly Planned[]) => planned.filter((each) => !here(each));
  return {
    status: "ready",
    // Every one on its database, the records it autosaves there included, so pinned together.
    stages: inGroup(stages, record),
    before: [
      ...elsewhere(parts.first).flatMap(({ plan }) => stagesOf(plan)),
      ...nested.flatMap((plan) => plan.before),
    ],
    after: [
      ...nested.flatMap((plan) => plan.after),
      ...builtElsewhere(record, parts.autosaves, elsewhere(parts.children)),
    ],
  };
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
  planned: readonly Planned[],
): Stage[] {
  if (planned.length === 0) return [own];
  const [first, ...rest] = combine(planned.map(({ plan }) => plan.stages));
  const linked = [afterLinking(first!, () => linkRecords(owner, autosaves)), ...rest];
  return ownerKeysKnown(owner, autosaves) ? combine([[own], linked]) : [own, ...linked];
}

/**
 * The stages of the records built through `owner`'s associations to other databases, written
 * after it: each association's records together, on its database. They're linked to the owner's
 * key, which it has by then, just before the first.
 */
function builtElsewhere(
  owner: Model,
  autosaves: readonly Autosave[],
  planned: readonly Planned[],
): Stage[] {
  const crossing = autosaves.filter(({ association }) => association.crossesDatabases);
  const stages = crossing.flatMap(({ association }) => {
    const plans = planned
      .filter((each) => each.association === association)
      .map(({ plan }) => plan);
    return [
      ...plans.flatMap((plan) => plan.before),
      ...inGroup(combine(plans.map((plan) => plan.stages)), association),
      ...plans.flatMap((plan) => plan.after),
    ];
  });
  const [first, ...rest] = stages;
  if (first === undefined) return [];
  return [afterLinking(first, () => linkRecords(owner, crossing)), ...rest];
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
  const deletion = recordState.isNew ? [] : [compileDelete(modelOf(record), recordState.storedKey)];
  const own = stageOf(record, [record], () => [
    {
      statements: deletion,
      commit: () => recordState.markDestroyed(),
      after: () => runAfterCallbacks(record, "afterDestroy", "destroy"),
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
  recordState.loadRow(row);
}
