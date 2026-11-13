// A hasMany's collection methods on `user.posts()`: `push`, `delete`, `destroy` and `clear`, kept in step with what the owner holds.
import { savingGroups } from "./autosave.ts";
import { pinBefore } from "./executor.ts";
import { prepareSave, type Ready } from "./lifecycle.ts";
import { Model, modelOf } from "./model.ts";
import type { OwnedCollection } from "./owned-collection.ts";
import { linksOf, state } from "./record-state.ts";
import type { ResolvedAssociation } from "./resolved-association.ts";
import { combine, inGroup, runStages, type Stage } from "./unit-of-work.ts";

/** What `user.posts()` has besides its Relation's methods, as Rails' collection proxy does. */
export interface CollectionMethods<M extends Model> {
  /**
   * Adds records to the association (Rails' `<<`): sets each one's foreign key and saves them
   * together, resolving to `false`, with nothing written, if one can't be saved.
   */
  push(...records: M[]): Promise<boolean>;
}

/** The collection methods of `owner`'s hasMany `association`, which `collection` holds. */
export function collectionMethods<M extends Model>(
  owner: Model,
  association: ResolvedAssociation,
  collection: OwnedCollection,
): CollectionMethods<M> {
  return {
    async push(...records) {
      requireTargets(association, records);
      // A new owner saves them with it, as it saves the records built through it.
      if (owner[state].isNew) {
        for (const record of records) collection.built(record);
        return true;
      }
      const key = association.keyOf(owner);
      const { name, definition } = association;
      for (const record of records) record[state].writeKey(definition.foreignKey, key, name);
      if (!(await saveTogether(records, "push() needs its records"))) return false;
      for (const record of records) collection.created(record);
      return true;
    },
  };
}

/** Throws `TypeError` for a record that isn't of the association's Model, as Rails raises. */
function requireTargets(association: ResolvedAssociation, records: readonly unknown[]): void {
  for (const record of records) {
    if (record instanceof association.target) continue;
    const given = record instanceof Model ? `a ${modelOf(record).name}` : String(record);
    throw new TypeError(
      `${association.label} takes ${association.target.name} records, not ${given}`,
    );
  }
}

/**
 * Saves `records` as one write, as Rails' collection does in a transaction: `false`, with nothing
 * written, if one is invalid or a callback aborts it.
 */
async function saveTogether(records: readonly Model[], needs: string): Promise<boolean> {
  for (const record of records) {
    for (const group of savingGroups(record)) await pinBefore(linksOf(group.records), needs);
  }
  const claimed = new Set<Model>();
  const plans: Ready[] = [];
  for (const record of records) {
    const plan = await prepareSave(record, claimed);
    if (plan.status !== "ready") return false;
    plans.push(plan);
  }
  await runStages(together(plans), needs);
  return true;
}

/**
 * Several records' plans as one: what each writes on another database before, then their own
 * stages merged position by position, each one batch on their database, then what's after.
 */
function together(plans: readonly Ready[]): Stage[] {
  return [
    ...plans.flatMap((plan) => plan.before),
    ...inGroup(combine(plans.map((plan) => plan.stages)), {}),
    ...plans.flatMap((plan) => plan.after),
  ];
}
