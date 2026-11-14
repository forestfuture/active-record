// Which records saving an owner also writes through its associations, before or after it, and linking their keys.
import { modelOf, type Model } from "./model.ts";
import { state } from "./record-state.ts";
import { resolveAssociation, type ResolvedAssociation } from "./resolved-association.ts";

/** A record a save writes through one of its owner's associations. */
export interface Linked {
  association: ResolvedAssociation;
  record: Model;
}

/**
 * What saving an owner writes through its belongsTo associations, before it: the records it was
 * pointed at while they were new, linked once they're written, and those of them it saves first.
 */
export interface Before {
  pointedAt: Linked[];
  saved: Linked[];
}

/**
 * The records `owner` was pointed at through belongsTo while they were new. Its foreign keys
 * are linked to them when it's saved, even if they were saved on their own since (Rails links
 * whenever the association was set); the ones still new and not already part of the write
 * (`claimed`) are saved first.
 */
export function autosavedBefore(owner: Model, claimed: ReadonlySet<Model>): Before {
  const model = modelOf(owner);
  const pointedAt = owner[state].autosaves
    .allBelongsTo()
    .map(([name, record]) => ({ association: resolveAssociation(model, name), record }));
  const saved = pointedAt.filter(({ record }) => record[state].isNew && !claimed.has(record));
  return { pointedAt, saved };
}

/**
 * What saving `owner` writes after it, through its hasMany and hasOne associations: the records
 * built through them that are still new, leaving out any already claimed by the write being
 * prepared. While the owner is new, a hasMany's are every record added to it, saved ones pushed
 * onto it included, as Rails saves a new owner's whole collection, and a hasOne's is its record,
 * saved or not.
 */
export function autosavedAfter(owner: Model, claimed: ReadonlySet<Model>): Linked[] {
  const model = modelOf(owner);
  const ownerIsNew = owner[state].isNew;
  return owner[state].autosaves.allBuilt().flatMap(([name, built]) => {
    const association = resolveAssociation(model, name);
    return built
      .filter((record) => (ownerIsNew || record[state].isNew) && !claimed.has(record))
      .map((record) => ({ association, record }));
  });
}

/** Whether every record's key is known before it's written (generated in code). */
export function keysKnownBefore(pointedAt: readonly Linked[]): boolean {
  return pointedAt.every(
    ({ association, record }) => record[state].read(association.targetAttribute) !== null,
  );
}

/** Whether the owner's key, which every record takes, is known before anything is written. */
export function ownerKeyKnown(owner: Model, after: readonly Linked[]): boolean {
  return after.every(({ association }) => owner[state].read(association.ownerAttribute) !== null);
}

/** Points the owner at the records it points at, now that their keys exist, keeping them loaded. */
export function linkBefore(owner: Model, pointedAt: readonly Linked[]): void {
  for (const { association, record } of pointedAt) {
    const { name, ownerAttribute, targetAttribute } = association;
    owner[state].pointAt(name, ownerAttribute, record[state].read(targetAttribute), record);
    owner[state].autosaves.setBelongsTo(name, undefined);
  }
}

/**
 * Points every record saved after its owner at it. A hasOne's record stays the owner's loaded
 * association under the owner's new key.
 */
export function linkAfter(owner: Model, after: readonly Linked[]): void {
  for (const { association, record } of after) {
    const { name, definition, ownerAttribute } = association;
    record[state].writeKey(definition.foreignKey, owner[state].read(ownerAttribute), name);
    if (definition.kind === "hasOne") owner[state].associations.set(name, ownerAttribute, record);
  }
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
    const { saved } = autosavedBefore(each, new Set());
    for (const { association, record: next } of [...saved, ...autosavedAfter(each, found)]) {
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
