// Which records saving an owner also writes through its associations, before or after it, and linking their keys.
import { pointBackAtOwner } from "./point-back-at-owner.ts";
import { associationsOf } from "./association-fields.ts";
import type { AssociationKind } from "./associations.ts";
import { modelOf, type Model, type ModelClass } from "./model.ts";
import { state } from "./record-state.ts";
import { resolveAssociation, type ResolvedAssociation } from "./resolved-association.ts";

/** A record a save writes through one of its owner's associations. */
export interface Linked {
  association: ResolvedAssociation;
  record: Model;
  /** A hasMany's loaded record, saved as it is, without pointing it at the owner again. */
  keepsKey?: true;
  /** Marked for destruction (#37): destroyed, not saved. */
  destroys?: true;
}

/** A record saved or destroyed through an association already known. */
type Entry = Omit<Linked, "association">;

/**
 * What saving an owner writes through its belongsTo associations: the records it was pointed at
 * while they were new, linked once they're written; those it saves first; and with `autosave:
 * true`, the records marked for destruction, destroyed after it once it no longer points at them.
 */
export interface Before {
  pointedAt: Linked[];
  saved: Linked[];
  destroyed: Linked[];
}

/**
 * The records `owner` was pointed at through belongsTo while they were new. Its foreign keys
 * are linked to them when it's saved, even if they were saved on their own since;
 * the ones still new and not already part of the write
 * (`claimed`) are saved first. Through an `autosave: true` belongsTo, its loaded record is saved
 * first too when it changed, or destroyed after it when it's marked (#37).
 */
export function autosavedBefore(owner: Model, claimed: ReadonlySet<Model>): Before {
  const model = modelOf(owner);
  const marked = ({ association, record }: Linked) =>
    association.definition.autosave === true && record[state].isMarkedForDestruction;
  const all = owner[state].autosaves
    .allBelongsTo()
    .map(([name, record]) => linkedThrough(model, name, record));
  const pointedAt = all.filter((each) => !marked(each));
  const unsaved = (each: Linked) => each.record[state].isNew && !claimed.has(each.record);
  const loadedSaved = loadedBelongsTo(owner, claimed);
  return {
    pointedAt,
    saved: [
      ...pointedAt.filter(unsaved),
      ...loadedSaved.filter((each) => !marked(each) && isChangedForAutosave(each.record)),
    ],
    // A new one marked is destroyed too, writing nothing.
    destroyed: [
      ...all.filter((each) => marked(each) && unsaved(each)),
      ...loadedSaved.filter(marked),
    ].map((each) => ({ ...each, destroys: true })),
  };
}

/** The saved records `owner`'s `autosave: true` belongsTo associations have loaded. */
function loadedBelongsTo(owner: Model, claimed: ReadonlySet<Model>): Linked[] {
  const model = modelOf(owner);
  return [...associationsOf(model)].flatMap(([name, { kind, autosave }]) => {
    if (kind !== "belongsTo" || autosave !== true) return [];
    return loaded(owner, name)
      .filter((record) => !record[state].isNew && !claimed.has(record))
      .map((record) => linkedThrough(model, name, record));
  });
}

/**
 * `record`, linked through `model`'s belongsTo `name`: for a polymorphic one (#60), through the
 * branch for the record's Model, which links its key.
 */
function linkedThrough(model: ModelClass, name: string, record: Model): Linked {
  const association = resolveAssociation(model, name);
  return { association: association.branchForRecord(record) ?? association, record };
}

/**
 * Clears the foreign keys that point the owner at records it destroys,
 * and a polymorphic belongsTo's type with it (#60), as `set(null)` does, and forgets a new one it
 * was to save first.
 */
export function unlink(owner: Model, destroyed: readonly Linked[]): void {
  for (const { association } of destroyed) {
    owner[state].writeKey(association.ownerAttribute, null, association.name);
    if (association.isPolymorphic) owner[state].write(association.type!.attribute, null);
    owner[state].autosaves.setBelongsTo(association.name, undefined);
  }
}

/**
 * What saving `owner` writes after it, through its hasMany and hasOne associations in the order
 * they're declared, leaving out any record already claimed by the write being prepared: the
 * records built through each that are still new, or with `autosave: true` what `withAutosave`
 * says. While the owner is new, a hasMany's are every record added to it, saved ones pushed onto
 * it included, since a new owner saves its whole collection, and a hasOne's is its record, saved
 * or not.
 */
export function autosavedAfter(owner: Model, claimed: ReadonlySet<Model>): Linked[] {
  const model = modelOf(owner);
  return [...associationsOf(model)].flatMap(([name, { kind, autosave, through }]) => {
    // A through association's records are saved by its join records, which point at them.
    if (kind === "belongsTo" || through !== undefined) return [];
    const entries = autosave
      ? withAutosave(owner, name, kind, claimed)
      : builtToSave(owner, name, claimed).map((record) => ({ record }));
    if (entries.length === 0) return [];
    const association = resolveAssociation(model, name);
    return entries.map((entry) => ({ association, ...entry }));
  });
}

/**
 * What an `autosave: true` association writes after its owner (#37): its saved
 * records marked for destruction are destroyed, then its loaded records that changed are saved,
 * then those built through it. Marked records never saved are left out (`dropUnsavedMarked`).
 */
function withAutosave(
  owner: Model,
  name: string,
  kind: AssociationKind,
  claimed: ReadonlySet<Model>,
) {
  const built = builtToSave(owner, name, claimed);
  const stored = loaded(owner, name).filter(
    (record) => !record[state].isNew && !claimed.has(record) && !built.includes(record),
  );
  const marked = (record: Model) => record[state].isMarkedForDestruction;
  const keepsKey = kind === "hasMany" ? ({ keepsKey: true } as const) : {};
  const destroyed: Entry[] = [...stored, ...built]
    .filter((record) => marked(record) && !record[state].isNew)
    .map((record) => ({ record, destroys: true }));
  return [
    ...destroyed,
    ...stored
      .filter((record) => !marked(record) && isChangedForAutosave(record))
      .map((record) => ({ record, ...keepsKey })),
    ...built.filter((record) => !marked(record)).map((record) => ({ record })),
  ];
}

/**
 * Takes the records marked for destruction that were never saved out of `owner`'s `autosave:
 * true` associations, writing nothing, when the owner is saved.
 */
export function dropUnsavedMarked(owner: Model): void {
  const model = modelOf(owner);
  for (const [name, { kind, autosave }] of associationsOf(model)) {
    if (kind === "belongsTo" || autosave !== true) continue;
    const association = resolveAssociation(model, name);
    for (const record of owner[state].autosaves.built(name)) {
      if (record[state].isNew && record[state].isMarkedForDestruction) {
        forget(owner, association, record);
      }
    }
  }
}

/** Takes `record` out of what `owner`'s association holds: built through it, or loaded. */
export function forget(owner: Model, association: ResolvedAssociation, record: Model): void {
  const { name } = association;
  owner[state].autosaves.removeBuilt(name, [record]);
  const value = owner[state].associations.get(name)?.value;
  if (Array.isArray(value)) {
    const kept = value.filter((each) => each !== record);
    owner[state].associations.set(name, association.keyAttributes, kept);
  } else if (value === record) {
    owner[state].associations.set(name, association.keyAttributes, null);
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
 * Whether saving `record` through an `autosave: true` association would write anything:
 * it's new, changed or marked for destruction, or so is a record of one of its own `autosave:
 * true` associations, at any level. `seen` stops a loop of records loaded through each other.
 */
function isChangedForAutosave(record: Model, seen = new Set<Model>()): boolean {
  if (seen.has(record)) return false;
  seen.add(record);
  const recordState = record[state];
  if (recordState.isNew || recordState.isMarkedForDestruction) return true;
  if (recordState.changedNames().length > 0) return true;
  return [...associationsOf(modelOf(record))].some(
    ([name, { autosave }]) =>
      autosave === true && loaded(record, name).some((each) => isChangedForAutosave(each, seen)),
  );
}

/** Whether every record's key is known before it's written (generated in code). */
export function isEveryKeyKnown(pointedAt: readonly Linked[]): boolean {
  return pointedAt.every(
    ({ association, record }) => record[state].read(association.targetAttribute) !== null,
  );
}

/** Whether the owner's key, which every record takes, is known before anything is written. */
export function isOwnerKeyKnown(owner: Model, after: readonly Linked[]): boolean {
  return after.every(({ association }) => owner[state].read(association.ownerAttribute) !== null);
}

/** Points the owner at the records it points at, now that their keys exist, keeping them loaded. */
export function linkBefore(owner: Model, pointedAt: readonly Linked[]): void {
  for (const { association, record } of pointedAt) {
    owner[state].pointAt(association, record[state].read(association.targetAttribute), record);
    owner[state].autosaves.setBelongsTo(association.name, undefined);
  }
}

/**
 * Points every record saved after its owner at it, keeping the owner loaded as its inverse
 * (#62). A hasOne's record stays the owner's loaded association under the owner's new key.
 */
export function linkAfter(owner: Model, after: readonly Linked[]): void {
  for (const { association, record, keepsKey, destroys } of after) {
    if (keepsKey || destroys) continue;
    const { name, definition, ownerAttribute } = association;
    record[state].writeKey(definition.foreignKey, owner[state].read(ownerAttribute), name);
    association.writeOwnersType(record);
    pointBackAtOwner(owner, association, record);
    if (definition.kind === "hasOne") {
      owner[state].associations.set(name, association.keyAttributes, record);
    }
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
 * The records saving `record` would write, by database (#228): it, the records it saves or
 * destroys through its associations, at every level. A record reached through an association to
 * another database starts a group of its own. Found without running any validation or callback,
 * so a save can be checked before anything runs (#93).
 */
export function savingGroups(record: Model): SavingGroup[] {
  const found = new Set<Model>();
  const groups: SavingGroup[] = [{ records: [], through: undefined }];
  const visit = (each: Model, group: SavingGroup): void => {
    if (found.has(each)) return;
    found.add(each);
    group.records.push(each);
    const { saved, destroyed } = autosavedBefore(each, new Set());
    const linked = [...saved, ...destroyed, ...autosavedAfter(each, found)];
    for (const { association, record: next } of linked) {
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
