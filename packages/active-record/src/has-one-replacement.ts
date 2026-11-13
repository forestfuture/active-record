// Replacing a hasOne's record (#40): what a new record does to the old one, by `dependent:`, written in one batch with the new one.
import { compileDelete } from "./compiler.ts";
import { NotNullViolation, RecordNotSaved } from "./errors.ts";
import {
  prepareDestroy,
  prepareSave,
  refusalError,
  stagesOf,
  type Claimed,
  type Ready,
} from "./lifecycle.ts";
import { modelOf, type Model } from "./model.ts";
import { state } from "./record-state.ts";
import type { ResolvedAssociation } from "./resolved-association.ts";
import { combine, inGroup, runStages, stageOf, type PreparedWrite } from "./unit-of-work.ts";

/**
 * A saved owner's new hasOne record, and the record it replaces: the one loaded then, none
 * (`null`), or `undefined` when nothing was loaded, so it's read when the new record is written.
 */
export interface Replacement {
  owner: Model;
  association: ResolvedAssociation;
  replaced: Model | null | undefined;
}

/** Each new hasOne record still to replace its owner's old one. Not request state. */
const replacing = new WeakMap<Model, Replacement>();

/**
 * The record `owner`'s hasOne holds now, which a new one replaces: an unsaved one built through it
 * passes on the record it was to replace.
 */
export function replacedBy(
  owner: Model,
  association: ResolvedAssociation,
): Model | null | undefined {
  const loaded = owner[state].associations.get(association.name);
  if (loaded === undefined) return undefined;
  const record = loaded.value as Model | null;
  if (record === null || !record[state].isNew) return record;
  const replacement = replacing.get(record);
  return replacement === undefined ? null : replacement.replaced;
}

/** `replacedBy`, and an unsaved record built through the association stops replacing it. */
export function takeReplaced(
  owner: Model,
  association: ResolvedAssociation,
): Model | null | undefined {
  const replaced = replacedBy(owner, association);
  const loaded = owner[state].associations.get(association.name)?.value as Model | null | undefined;
  if (loaded !== undefined && loaded !== null) replacing.delete(loaded);
  return replaced;
}

/** Makes `record`, new for a saved owner, replace `replaced` when it's written. */
export function markReplacing(record: Model, replacement: Replacement): void {
  replacing.set(record, replacement);
}

/** What `record` replaces when it's written, if anything. */
export function replacementOf(record: Model): Replacement | undefined {
  return replacing.get(record);
}

/** `record` replaces nothing any more. */
export function forgetReplacing(record: Model): void {
  replacing.delete(record);
}

/**
 * What writing `record` does to the record it replaces, prepared: its destroy, delete or
 * nullify, by the association's `dependent:`, for the same batch as `record`'s own write, before
 * it. Undefined when it replaces nothing.
 */
export async function prepareReplacement(
  record: Model,
  claimed: Claimed,
): Promise<Ready | undefined> {
  const replacement = replacing.get(record);
  if (replacement === undefined) return undefined;
  const old = await replacedRecord(record, replacement);
  if (old === null) {
    replacing.delete(record);
    return undefined;
  }
  const removal = await prepareRemoval(old, replacement.association, claimed);
  const done = stageOf(record, [], () => [
    { statements: [], commit: () => replacing.delete(record), after: async () => {} },
  ]);
  return { ...removal, stages: combine([removal.stages, [done]]) };
}

/**
 * A save's plan with `removal` written in the batch that writes `record`, before it: after any
 * new record it points at whose key the database generates, which is written a batch earlier.
 */
export function withRemoval(plan: Ready, removal: Ready | undefined, record: Model): Ready {
  if (removal === undefined) return plan;
  const own = plan.stages.findIndex((stage) => stage.records.includes(record));
  const stages = [
    ...plan.stages.slice(0, own),
    ...combine([removal.stages, plan.stages.slice(own)]),
  ];
  return {
    status: "ready",
    stages: inGroup(stages, record),
    before: [...removal.before, ...plan.before],
    after: [...plan.after, ...removal.after],
  };
}

/** `set(null)` on a saved owner: the record it replaces removed now, by `dependent:`. */
export async function removeReplaced(replacement: Replacement): Promise<void> {
  const old = await replacedRecord(null, replacement);
  if (old === null) return;
  const removal = await prepareRemoval(old, replacement.association, new Set());
  await runStages(stagesOf(removal), "set() needs its records");
}

/**
 * The saved record `record` replaces: the one known when it was given to the association, or the
 * owner's first one now. None when that's `record` itself.
 */
async function replacedRecord(
  record: Model | null,
  { owner, association, replaced }: Replacement,
): Promise<Model | null> {
  const found =
    replaced !== undefined
      ? replaced
      : await association.firstLinkedTo(owner[state].executor, association.keyOf(owner));
  if (found === null || found === record || found[state].isNew || found[state].isDestroyed) {
    return null;
  }
  if (record !== null && !record[state].isNew && sameRow(found, record)) return null;
  return found;
}

/** Whether two saved records of one Model are the same row. */
function sameRow(one: Model, other: Model): boolean {
  return modelOf(one) === modelOf(other) && Object.is(one[state].storedKey, other[state].storedKey);
}

/** The old record's removal, as Rails removes it: destroyed, deleted, or else nullified. */
async function prepareRemoval(
  old: Model,
  association: ResolvedAssociation,
  claimed: Claimed,
): Promise<Ready> {
  const { dependent } = association.definition;
  if (dependent === "destroy") {
    const plan = await prepareDestroy(old, claimed);
    if (plan.status !== "ready") throw refusalError(old, plan, "destroy");
    return plan;
  }
  if (dependent === "delete") {
    if (claimed.has(old)) return { status: "ready", stages: [], before: [], after: [] };
    claimed.add(old);
    const deletion = compileDelete(modelOf(old), old[state].storedKey);
    const write: PreparedWrite = {
      statements: [deletion],
      commit: () => old[state].markDestroyed(),
      after: async () => {},
    };
    return { status: "ready", stages: [stageOf(old, [old], () => [write])], before: [], after: [] };
  }
  return nullify(old, association, claimed);
}

/**
 * The old record with its foreign key set to null, saved: validated, with its callbacks. One that
 * can't be saved, refused or by a NOT NULL foreign key, throws `RecordNotSaved` as in Rails, and
 * nothing is written; one refused before writing keeps its key.
 */
async function nullify(
  old: Model,
  association: ResolvedAssociation,
  claimed: Claimed,
): Promise<Ready> {
  const { name, definition } = association;
  const key = old[state].read(definition.foreignKey);
  old[state].writeKey(definition.foreignKey, null, name);
  const plan = await prepareSave(old, claimed);
  if (plan.status === "ready") return undoneOnFailure(plan, old, association, key);
  old[state].writeKey(definition.foreignKey, key, name);
  throw new RecordNotSaved(failedToRemove(name));
}

/**
 * A nullify's plan whose batch, if it fails, gives the old record its key back, and turns the
 * database refusing its null foreign key into `RecordNotSaved`.
 */
function undoneOnFailure(
  plan: Ready,
  old: Model,
  association: ResolvedAssociation,
  key: unknown,
): Ready {
  const { name, definition } = association;
  // The database doesn't say which statement failed, so in a `db.batch` that also writes a null
  // into this column, that write's violation reads as this one; the original is the `cause`.
  const failed = (error: unknown) => {
    old[state].writeKey(definition.foreignKey, key, name);
    const refused =
      error instanceof NotNullViolation &&
      error.table === modelOf(old).table &&
      error.attributes.includes(definition.foreignKey);
    return refused ? new RecordNotSaved(failedToRemove(name), { cause: error }) : undefined;
  };
  const stages = plan.stages.map((stage) => ({
    ...stage,
    writes: () => stage.writes().map((write) => ({ ...write, failed })),
  }));
  return { ...plan, stages };
}

/** Rails' message for an old record that can't be nullified. */
function failedToRemove(name: string): string {
  return (
    `Failed to remove the existing associated ${name}. ` +
    "The record failed to save after its foreign key was set to null."
  );
}
