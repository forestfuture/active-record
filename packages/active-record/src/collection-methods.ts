// A hasMany's collection methods on `user.posts()`: `push`, `delete`, `destroy` and `clear`, kept in step with what the owner holds.
import { savingGroups } from "./autosave.ts";
import { pinBefore } from "./executor.ts";
import { prepareDestroy, prepareSave, refusalError, type Ready } from "./lifecycle.ts";
import { Model, modelOf } from "./model.ts";
import type { OwnedCollection } from "./owned-collection.ts";
import { isOwnersKey } from "./point-back-at-owner.ts";
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
  /**
   * Removes records from the association by its `dependent:` strategy, as Rails' collection
   * `delete`: destroys them with `"destroy"`, deletes their rows with `"deleteAll"`, and
   * otherwise sets their foreign key to NULL. Resolves to the records.
   */
  delete(...records: M[]): Promise<M[]>;
  /**
   * Destroys records of the association, callbacks and dependents included, whatever its
   * `dependent:` is, in one write: if one refuses, it throws `RecordNotDestroyed` and nothing
   * is destroyed. Resolves to the records.
   */
  destroy(...records: M[]): Promise<M[]>;
}

/** The collection methods of `owner`'s hasMany `association`, which `collection` holds. */
export function collectionMethods<M extends Model>(
  owner: Model,
  association: ResolvedAssociation,
  collection: OwnedCollection,
): CollectionMethods<M> {
  const held: Held = { owner, association, collection };
  return {
    push: (...records) => push(held, records),
    delete: (...records) => remove(held, records, removalOf(association), "delete"),
    destroy: (...records) => remove(held, records, "destroy", "destroy"),
  };
}

/** How records leave the association. */
type Removal = "destroy" | "deleteAll" | "nullify";

/** How `delete` removes records: by the association's `dependent:`, nullifying by default. */
function removalOf({ definition: { dependent } }: ResolvedAssociation): Removal {
  return dependent === "destroy" || dependent === "deleteAll" ? dependent : "nullify";
}

/** An owner's hasMany, as its collection methods use it. */
interface Held {
  owner: Model;
  association: ResolvedAssociation;
  collection: OwnedCollection;
}

async function push({ owner, association, collection }: Held, records: Model[]): Promise<boolean> {
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
}

/**
 * Removes `records` from the association, as `method` does. Those with no row of their own to
 * change (new records, or any of a new owner's) just leave it, as in Rails.
 */
async function remove<M extends Model>(
  held: Held,
  records: M[],
  removal: Removal,
  method: string,
): Promise<M[]> {
  const { owner, association, collection } = held;
  requireTargets(association, records);
  requireMembers(held, records);
  const stored = owner[state].isNew ? [] : records.filter((record) => !record[state].isNew);
  if (removal === "destroy") await destroyTogether(stored, `${method}() needs its records`);
  else if (stored.length > 0) await removeRows(held, stored, removal === "deleteAll");
  collection.removed(records);
  return records;
}

/** Deletes the records' rows, or sets their foreign key to NULL, in one statement. */
async function removeRows({ owner, association }: Held, records: Model[], deletes: boolean) {
  const { target, definition } = association;
  const keys = records.map((record) => record[state].read(target.primaryKey));
  const rows = association
    .linkedTo(owner[state].executor, association.keyOf(owner))
    .where({ [target.primaryKey]: keys });
  // The foreign key was checked as a target attribute when the Model was prepared.
  await (deletes ? rows.deleteAll() : rows.updateAll({ [definition.foreignKey]: null } as never));
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
 * Throws `TypeError` for a record the association doesn't hold: not built or pushed through it,
 * and with a foreign key that isn't its owner's.
 */
function requireMembers({ owner, association }: Held, records: readonly Model[]): void {
  const added = owner[state].autosaves.built(association.name);
  for (const record of records) {
    if (added.includes(record)) continue;
    const linked = record[state].read(association.targetAttribute);
    if (linked !== null && isOwnersKey(linked, owner, association)) continue;
    const ownerName = association.owner.name;
    const whose = linked === null ? `no ${ownerName}` : `another ${ownerName}`;
    throw new TypeError(
      `${association.label} doesn't hold this ${association.target.name}: it belongs to ${whose}`,
    );
  }
}

/**
 * Destroys `records` as one write, callbacks and dependents included, as Rails' collection does
 * in a transaction: if one refuses, it throws, with nothing written.
 */
async function destroyTogether(records: readonly Model[], needs: string): Promise<void> {
  await pinBefore(linksOf(records), needs);
  const claimed = new Set<Model>();
  const plans: Ready[] = [];
  for (const record of records) {
    const plan = await prepareDestroy(record, claimed);
    if (plan.status !== "ready") throw refusalError(record, plan, "destroy");
    plans.push(plan);
  }
  await runStages(together(plans), needs);
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
