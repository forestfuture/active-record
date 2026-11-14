// Which records saving an owner also writes through its associations, before or after it, and linking their keys.
import { associationsOf } from "./association-fields.ts";
import { modelOf, type Model } from "./model.ts";
import { state } from "./record-state.ts";
import { resolveAssociation, type ResolvedAssociation } from "./resolved-association.ts";

/** A record a save writes through one of its owner's associations. */
export interface Linked {
  association: ResolvedAssociation;
  record: Model;
  /** A hasMany's loaded record, saved as it is: Rails doesn't point it at the owner again. */
  keepsKey?: true;
  /** Marked for destruction (#37): destroyed, not saved. */
  destroys?: true;
}

/** A record saved or destroyed through an association already known. */
type Entry = Omit<Linked, "association">;

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
 * What saving `owner` writes after it, through its hasMany and hasOne associations in the order
 * they're declared, leaving out any record already claimed by the write being prepared: the
 * records built through each that are still new, or with `autosave: true` what `withAutosave`
 * says. While the owner is new, a hasMany's are every record added to it, saved ones pushed onto
 * it included, as Rails saves a new owner's whole collection, and a hasOne's is its record, saved
 * or not.
 */
export function autosavedAfter(owner: Model, claimed: ReadonlySet<Model>): Linked[] {
  const model = modelOf(owner);
  return [...associationsOf(model)].flatMap(([name, { kind, autosave }]) => {
    if (kind === "belongsTo") return [];
    const entries = autosave
      ? withAutosave(owner, name, kind, claimed)
      : builtToSave(owner, name, claimed).map((record) => ({ record }));
    if (entries.length === 0) return [];
    const association = resolveAssociation(model, name);
    return entries.map((entry) => ({ association, ...entry }));
  });
}

/**
 * What an `autosave: true` association writes after its owner (#37), as Rails does: its saved
 * records marked for destruction are destroyed, then its loaded records that changed are saved,
 * then those built through it. Marked records never saved are left out (`dropUnsavedMarked`).
 */
function withAutosave(owner: Model, name: string, kind: string, claimed: ReadonlySet<Model>) {
  const built = builtToSave(owner, name, claimed);
  const stored = loaded(owner, name).filter(
    (record) => !record[state].isNew && !claimed.has(record) && !built.includes(record),
  );
  const marked = (record: Model) => record[state].markedForDestruction;
  const keepsKey = kind === "hasMany" ? ({ keepsKey: true } as const) : {};
  const destroyed: Entry[] = [...stored, ...built]
    .filter((record) => marked(record) && !record[state].isNew)
    .map((record) => ({ record, destroys: true }));
  return [
    ...destroyed,
    ...stored
      .filter((record) => !marked(record) && changedForAutosave(record))
      .map((record) => ({ record, ...keepsKey })),
    ...built.filter((record) => !marked(record)).map((record) => ({ record })),
  ];
}

/**
 * Takes the records marked for destruction that were never saved out of `owner`'s `autosave:
 * true` associations, writing nothing, as Rails does when it saves the owner.
 */
export function dropUnsavedMarked(owner: Model): void {
  const model = modelOf(owner);
  for (const [name, { kind, autosave }] of associationsOf(model)) {
    if (kind === "belongsTo" || autosave !== true) continue;
    const association = resolveAssociation(model, name);
    for (const record of owner[state].autosaves.built(name)) {
      if (record[state].isNew && record[state].markedForDestruction) {
        forget(owner, association, record);
      }
    }
  }
}

/** Takes `record` out of what `owner`'s association holds: built through it, or loaded. */
export function forget(owner: Model, association: ResolvedAssociation, record: Model): void {
  const { name, ownerAttribute } = association;
  owner[state].autosaves.removeBuilt(name, [record]);
  const value = owner[state].associations.get(name)?.value;
  if (Array.isArray(value)) {
    const kept = value.filter((each) => each !== record);
    owner[state].associations.set(name, ownerAttribute, kept);
  } else if (value === record) {
    owner[state].associations.set(name, ownerAttribute, null);
  }
}

/** The records built through the association that saving `owner` saves after it. */
function builtToSave(owner: Model, name: string, claimed: ReadonlySet<Model>): readonly Model[] {
  const ownerIsNew = owner[state].isNew;
  return owner[state].autosaves
    .built(name)
    .filter((record) => (ownerIsNew || record[state].isNew) && !claimed.has(record));
}

/** The association's loaded records, for the key the owner holds now: none when it isn't loaded. */
function loaded(owner: Model, name: string): readonly Model[] {
  const value = owner[state].associations.get(name)?.value as Model | Model[] | null | undefined;
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

/**
 * Whether saving `record` through an `autosave: true` association would write anything, as Rails'
 * `changed_for_autosave?`: it's new, changed or marked for destruction, or so is a record of one of its own `autosave:
 * true` associations, at any level. `seen` stops a loop of records loaded through each other.
 */
function changedForAutosave(record: Model, seen = new Set<Model>()): boolean {
  if (seen.has(record)) return false;
  seen.add(record);
  const recordState = record[state];
  if (recordState.isNew || recordState.markedForDestruction) return true;
  if (recordState.changedNames().length > 0) return true;
  return [...associationsOf(modelOf(record))].some(
    ([name, { autosave }]) =>
      autosave === true && loaded(record, name).some((each) => changedForAutosave(each, seen)),
  );
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
  for (const { association, record, keepsKey, destroys } of after) {
    if (keepsKey || destroys) continue;
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
