// A hasMany's collection methods on `user.posts()`: `push`, `delete`, `destroy` and `clear`, kept in step with what the owner holds.
import { savingGroups } from "./autosave.ts";
import { RecordNotSaved } from "./errors.ts";
import { pinBefore } from "./executor.ts";
import {
  prepareDestroy,
  prepareSave,
  refusalError,
  type Claimed,
  type DestroyPlan,
  type Ready,
  type SavePlan,
} from "./lifecycle.ts";
import { Model, modelOf } from "./model.ts";
import type { AssociationCollection } from "./owned-collection.ts";
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
  /**
   * Removes every record of the association as `deleteAll()` does, by its `dependent:`, and
   * forgets the records built through it: afterwards it reads as empty without a query.
   */
  clear(): Promise<void>;
}

/** The collection methods of `hasMany`, one owner's hasMany association. */
export function collectionMethods<M extends Model>(hasMany: OwnersHasMany): CollectionMethods<M> {
  const { association, collection, relation } = hasMany;
  return {
    push: (...records) => push(hasMany, records),
    delete: (...records) =>
      remove(hasMany, records, removalOf(association), "delete() needs its records"),
    destroy: (...records) => remove(hasMany, records, "destroy", "destroy() needs its records"),
    async clear() {
      await relation.deleteAll();
      collection.emptied();
    },
  };
}

/** How records leave the association. */
type Removal = "destroy" | "deleteAll" | "nullify";

/** How `delete` removes records: by the association's `dependent:`, nullifying by default. */
function removalOf({ definition: { dependent } }: ResolvedAssociation): Removal {
  return dependent === "destroy" || dependent === "deleteAll" ? dependent : "nullify";
}

/** An owner's hasMany, as its collection methods use it. */
interface OwnersHasMany {
  owner: Model;
  association: ResolvedAssociation;
  /** What the owner holds of it. */
  collection: AssociationCollection;
  /** Its Relation, whose `deleteAll()` follows `dependent:`. */
  relation: { deleteAll(): Promise<number> };
}

async function push(hasMany: OwnersHasMany, records: Model[]): Promise<boolean> {
  const { owner, association, collection } = hasMany;
  requireTargets(association, records);
  // A new owner saves them with it, as it saves the records built through it.
  if (owner[state].isNew) {
    for (const record of records) collection.built(record);
    return true;
  }
  const reason = collection.refusal;
  if (reason !== undefined) {
    throw new RecordNotSaved(`You cannot push a ${association.target.name} here: ${reason}`);
  }
  const needs = "push() needs its records";
  // Every check that can throw comes first, so a refused push leaves the records as they were.
  for (const record of records) record[state].requireLive("be saved");
  await pinForSaving(records, needs);
  link(hasMany, records);
  // Saved as one write, as Rails' collection saves in a transaction: none if one refuses.
  if ((await writeTogether(records, prepareSave, needs)) !== undefined) return false;
  for (const record of records) collection.created(record);
  return true;
}

/** Writes the owner's key into each record, which then has the owner loaded as its belongsTo. */
function link({ owner, association, collection }: OwnersHasMany, records: readonly Model[]): void {
  const key = association.keyOf(owner);
  const { name, definition } = association;
  for (const record of records) {
    record[state].writeKey(definition.foreignKey, key, name);
    // So a required belongsTo passes without a query, as for a record created through it (#339).
    collection.pointBack(record);
  }
}

/**
 * Removes `records` from the association, as `removal` says (`needs` begins the error for records
 * on two databases). Those with no row of their own to change (new records, or any of a new
 * owner's) just leave it, as in Rails.
 */
async function remove<M extends Model>(
  hasMany: OwnersHasMany,
  records: M[],
  removal: Removal,
  needs: string,
): Promise<M[]> {
  const { owner, association, collection } = hasMany;
  requireTargets(association, records);
  requireMembers(hasMany, records);
  const stored = owner[state].isNew ? [] : records.filter((record) => !record[state].isNew);
  if (removal === "destroy") await destroyTogether(stored, needs);
  else if (stored.length > 0) await removeRows(hasMany, stored, removal === "deleteAll");
  collection.removed(records);
  return records;
}

/** Deletes the records' rows, or sets their foreign key to NULL, in one statement. */
async function removeRows(
  { owner, association }: OwnersHasMany,
  records: Model[],
  deletes: boolean,
) {
  const { target, definition } = association;
  const keys = records.map((record) => record[state].read(target.primaryKey));
  // A plain query of the owner's records, not the association's own Relation: a Relation
  // narrowed from that deletes rather than nullifying, and clears what the owner has loaded.
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
function requireMembers(hasMany: OwnersHasMany, records: readonly Model[]): void {
  const { owner, association, collection } = hasMany;
  const added = collection.added();
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
  const refused = await writeTogether(records, prepareDestroy, needs);
  if (refused !== undefined) throw refusalError(refused.record, refused.plan, "destroy");
}

/**
 * Pins `records`, and what saving them writes, to their databases before anything changes (#93):
 * the records with what they autosave on theirs, all together, so records from two databases
 * throw `IncompatibleRelation`; then each group reached through an association to another one.
 */
async function pinForSaving(records: readonly Model[], needs: string): Promise<void> {
  const groups = records.map((record) => savingGroups(record));
  await pinBefore(linksOf(groups.flatMap(([own]) => own?.records ?? [])), needs);
  for (const [, ...elsewhere] of groups) {
    for (const group of elsewhere) await pinBefore(linksOf(group.records), needs);
  }
}

/**
 * Prepares each record's save or destroy, then writes them all as one: or, if one refuses, writes
 * nothing and returns it, with its plan.
 */
async function writeTogether(
  records: readonly Model[],
  prepare: (record: Model, claimed: Claimed) => Promise<SavePlan | DestroyPlan>,
  needs: string,
): Promise<{ record: Model; plan: Exclude<SavePlan | DestroyPlan, Ready> } | undefined> {
  const claimed: Claimed = new Set();
  const plans: Ready[] = [];
  for (const record of records) {
    const plan = await prepare(record, claimed);
    if (plan.status !== "ready") return { record, plan };
    plans.push(plan);
  }
  await runStages(together(plans), needs);
  return undefined;
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
