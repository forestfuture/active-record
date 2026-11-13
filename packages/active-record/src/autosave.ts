// Saving an owner's autosaves: which records, before or after it, and linking their keys.
import { modelOf, type Model } from "./model.ts";
import { state } from "./record-state.ts";
import { resolveAssociation, type ResolvedAssociation } from "./resolved-association.ts";

/** One hasMany's or hasOne's new records, built through it, to save after their owner. */
export interface Autosave {
  association: ResolvedAssociation;
  records: Model[];
}

/**
 * What saving `owner` autosaves after it: the records built through its hasMany and hasOne
 * associations that are still new, leaving out any already claimed by the write being prepared.
 * While the owner is new, a hasMany's are every record added to it, saved ones pushed onto it
 * included, as Rails saves a new owner's whole collection, and a hasOne's is its record, saved
 * or not.
 */
export function autosavesOf(owner: Model, claimed: ReadonlySet<Model>): Autosave[] {
  const model = modelOf(owner);
  const ownerIsNew = owner[state].isNew;
  return owner[state].autosaves
    .allBuilt()
    .map(([name, built]) => {
      const association = resolveAssociation(model, name);
      // While the owner is new, a saved record given to a hasMany or hasOne is saved after it too,
      // with its key.
      const records = built.filter(
        (record) => (ownerIsNew || record[state].isNew) && !claimed.has(record),
      );
      return { association, records };
    })
    .filter(({ records }) => records.length > 0);
}

/** Whether every record's foreign key can be set before anything is written. */
export function ownerKeysKnown(owner: Model, autosaves: readonly Autosave[]): boolean {
  return autosaves.every(
    ({ association }) => owner[state].read(association.ownerAttribute) !== null,
  );
}

/**
 * Points every autosaved record at its owner. A hasOne's record stays the owner's loaded
 * association under the owner's new key.
 */
export function linkRecords(owner: Model, autosaves: readonly Autosave[]): void {
  for (const { association, records } of autosaves) {
    const { name, definition, ownerAttribute } = association;
    const value = owner[state].read(ownerAttribute);
    for (const record of records) {
      record[state].writeKey(definition.foreignKey, value, name);
      if (definition.kind === "hasOne") {
        owner[state].associations.set(name, ownerAttribute, record);
      }
    }
  }
}

/** A record a belongsTo points at, set while it was new: linked, and if still new saved, first. */
export interface BelongsToAutosave {
  association: ResolvedAssociation;
  record: Model;
}

/**
 * The records `owner` was pointed at through belongsTo while they were new. Its foreign keys
 * are linked to them when it's saved, even if they were saved on their own since (Rails links
 * whenever the association was set); the ones still new and unclaimed are saved first.
 */
export function belongsToAutosavesOf(owner: Model): BelongsToAutosave[] {
  const model = modelOf(owner);
  return owner[state].autosaves
    .allBelongsTo()
    .map(([name, record]) => ({ association: resolveAssociation(model, name), record }));
}

/** The records `owner` points at to save before it: new, and not already part of the write. */
export function unsavedBelongsTo(
  pointedAt: readonly BelongsToAutosave[],
  claimed: ReadonlySet<Model>,
): Linked[] {
  return pointedAt.filter(({ record }) => record[state].isNew && !claimed.has(record));
}

/** A record a save writes through one of its owner's associations. */
export interface Linked {
  association: ResolvedAssociation;
  record: Model;
}

/** The records of `autosaves`, each with the association it was built through. */
export function linkedRecords(autosaves: readonly Autosave[]): Linked[] {
  return autosaves.flatMap(({ association, records }) =>
    records.map((record) => ({ association, record })),
  );
}

/**
 * Records one save writes on one database: the saved record's own, or those an association to
 * another database (`through`) reaches, with the records they autosave on theirs.
 */
export interface SavingGroup {
  records: Model[];
  through: ResolvedAssociation | undefined;
}

/**
 * The records saving `record` would write, by database (#228): it, the new records it points at
 * through belongsTo, and the new records built through its associations, at every level. A
 * record reached through an association to another database starts a group of its own. Found
 * without running any validation or callback, so a save can be checked before anything runs (#93).
 */
export function savingGroups(record: Model): SavingGroup[] {
  const found = new Set<Model>();
  const groups: SavingGroup[] = [{ records: [], through: undefined }];
  const visit = (each: Model, group: SavingGroup): void => {
    if (found.has(each)) return;
    found.add(each);
    group.records.push(each);
    const pointedAt = unsavedBelongsTo(belongsToAutosavesOf(each), new Set());
    for (const { association, record: next } of [
      ...pointedAt,
      ...linkedRecords(autosavesOf(each, found)),
    ]) {
      visit(next, association.isCrossDatabase ? startGroup(groups, association) : group);
    }
  };
  visit(record, groups[0]!);
  return groups.filter(({ records }) => records.length > 0);
}

/** A new group of records, reached through `association`, added to `groups`. */
function startGroup(groups: SavingGroup[], association: ResolvedAssociation): SavingGroup {
  const group: SavingGroup = { records: [], through: association };
  groups.push(group);
  return group;
}

/** Whether every pointed-at record's key is known before it's written (generated in code). */
export function belongsToKeysKnown(pointedAt: readonly BelongsToAutosave[]): boolean {
  return pointedAt.every(
    ({ association, record }) => record[state].read(association.targetAttribute) !== null,
  );
}

/** Points the owner at the records it points at, now that their keys exist, keeping them loaded. */
export function linkBelongsTo(owner: Model, pointedAt: readonly BelongsToAutosave[]): void {
  for (const { association, record } of pointedAt) {
    const { name, ownerAttribute, targetAttribute } = association;
    owner[state].pointAt(name, ownerAttribute, record[state].read(targetAttribute), record);
    owner[state].autosaves.setBelongsTo(name, undefined);
  }
}
