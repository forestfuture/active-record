// Replacing a hasOne's record (#40): what a new record does to the old one, by `dependent:`, written in one batch with the new one.
import { compileDelete } from "./compiler.ts";
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
interface Replacement {
  owner: Model;
  association: ResolvedAssociation;
  replaced: Model | null | undefined;
}

/** Each new hasOne record still to replace its owner's old one. Not request state. */
const replacing = new WeakMap<Model, Replacement>();

/**
 * The record `owner`'s hasOne holds now, which a new one replaces: an unsaved one built through it
 * passes on the record it was to replace, and stops replacing it.
 */
export function takeReplaced(
  owner: Model,
  association: ResolvedAssociation,
): Model | null | undefined {
  const loaded = owner[state].associations.get(association.name);
  if (loaded === undefined) return undefined;
  const record = loaded.value as Model | null;
  if (record === null || !record[state].isNew) return record;
  const replacement = replacing.get(record);
  replacing.delete(record);
  return replacement === undefined ? null : replacement.replaced;
}

/** Makes `record`, new for a saved owner, replace `replaced` when it's written. */
export function markReplacing(record: Model, replacement: Replacement): void {
  replacing.set(record, replacement);
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

/** A save's plan with `removal` written before its own writes, in its first batch. */
export function withRemoval(plan: Ready, removal: Ready | undefined, record: Model): Ready {
  if (removal === undefined) return plan;
  return {
    status: "ready",
    stages: inGroup(combine([removal.stages, plan.stages]), record),
    before: [...removal.before, ...plan.before],
    after: [...plan.after, ...removal.after],
  };
}

/** `set(null)` on a saved owner: its record removed now, by `dependent:`. */
export async function removeReplaced(
  owner: Model,
  association: ResolvedAssociation,
  replaced: Model | null | undefined,
): Promise<void> {
  const old = await replacedRecord(null, { owner, association, replaced });
  if (old === null) return;
  await runStages(
    stagesOf(await prepareRemoval(old, association, new Set())),
    "set() needs its records",
  );
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
      : await association
          .inOrder(association.linkedTo(owner[state].executor, association.keyOf(owner)))
          .first();
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

/** The old record with its foreign key set to null, saved: validated, with its callbacks. */
async function nullify(
  old: Model,
  association: ResolvedAssociation,
  claimed: Claimed,
): Promise<Ready> {
  old[state].writeKey(association.definition.foreignKey, null, association.name);
  const plan = await prepareSave(old, claimed);
  if (plan.status !== "ready") throw refusalError(old, plan, "save");
  return plan;
}
