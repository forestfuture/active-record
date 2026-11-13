// A hasMany's Relation as its owner sees it (records built through it join the owner), or no owner.
import { pointBackAtOwner } from "./point-back-at-owner.ts";
import type { Model } from "./model.ts";
import { state } from "./record-state.ts";
import type { ResolvedAssociation } from "./resolved-association.ts";

/**
 * A hasMany as its owner holds it: the owner-side rules its Relation follows. The Relation
 * describes the query; this answers what the owner already knows. There are two adapters:
 * an owner with a key (its loaded records, cached on it, followed by the ones built through
 * it) and an owner without one (just what was built through it). A narrowed Relation of it
 * (`where`, `order`, a scope, …) keeps a narrowed form: records built or created through it
 * still join the owner, but reads query. A plain query's Relation holds `unowned`, which
 * knows nothing and joins nothing, so a Relation never asks whether it has an owner.
 */
export interface OwnedCollection {
  /** The records it holds without a query (stored, then built), or undefined if not loaded. */
  loaded(): readonly Model[] | undefined;
  /**
   * Starts a load from D1, called before its query is sent; the function it returns takes the
   * rows and gives the load's own records (then those built). It keeps them only if nothing
   * changed the association meanwhile (#181). Only the association itself has it, not narrowed ones.
   */
  startFill?<M extends Model>(): (records: readonly M[]) => M[];
  /** A record created through it joins the loaded records, as in Rails. */
  created(record: Model): void;
  /** A record built through it, for autosave. It points back at the owner, as one created does. */
  built(record: Model): void;
  /** A record built or created through it points back at its owner, if it has one (#339). */
  pointBack(record: Model): void;
  /** A statement was built through it, so what's loaded is no longer known. */
  invalidate(): void;
  /** How many records were built through it and not yet saved, which `size()` counts. */
  unsavedCount(): number;
  /** Why records can't be created through it, if they can't: its owner has no key. */
  readonly refusal: string | undefined;
  /**
   * The foreign key `deleteAll()` sets to NULL rather than deleting, as Rails' has_many does
   * without a deleting `dependent:`; undefined when it deletes.
   */
  readonly nullifies: string | undefined;
  /** Its foreign key and association, which a key that can't be cast names (#94); none unowned. */
  readonly link: { attribute: string; association: string } | undefined;
  /** Its form in a narrowed Relation. */
  narrowed(): OwnedCollection;
}

/** A plain query's: no owner, so it holds nothing, refuses nothing, and a deleteAll deletes. */
export const unowned: OwnedCollection = {
  loaded: () => undefined,
  created: () => {},
  built: () => {},
  pointBack: () => {},
  invalidate: () => {},
  unsavedCount: () => 0,
  refusal: undefined,
  nullifies: undefined,
  link: undefined,
  narrowed: () => unowned,
};

/**
 * A hasMany as the association itself holds it (`user.posts()`, not a Relation narrowed from it),
 * with what its collection methods (`push`, `delete`, `destroy`, `clear`) need besides.
 */
export interface AssociationCollection extends OwnedCollection {
  /** The records built or pushed through it and not saved with the owner yet, or kept since. */
  added(): readonly Model[];
  /** Records removed from it (`delete`, `destroy`): they leave what's loaded and added. */
  removed(records: readonly Model[]): void;
  /** Every record left it (`clear`): it holds none, loaded, and forgets those added. */
  emptied(): void;
}

/** `owner`'s hasMany `association`, as its Relation sees it. */
export function ownedCollection(
  owner: Model,
  association: ResolvedAssociation,
): AssociationCollection {
  const key = association.keyOf(owner);
  return key === null ? withoutKey(owner, association) : withKey(owner, association, key);
}

/** An owner with a key: its loaded records live in its association cache. */
function withKey(
  owner: Model,
  association: ResolvedAssociation,
  key: unknown,
): AssociationCollection {
  const { associations: loadedAssociations, autosaves } = owner[state];
  const { name, ownerAttribute, definition } = association;
  const built = () => autosaves.built(name);
  // The stored records, then those built through it and not among them, as Rails merges new
  // records into what it loads.
  const withBuilt = <M extends Model>(stored: readonly M[]): M[] => [
    ...stored,
    // Built through this association, so they're of its target Model, as the stored ones are.
    ...(built().filter((record) => !stored.includes(record as M)) as M[]),
  ];
  const collection: AssociationCollection = {
    added: built,
    loaded() {
      const stored = loadedAssociations.get(name)?.value as Model[] | undefined;
      return stored === undefined ? undefined : withBuilt(stored);
    },
    startFill<M extends Model>() {
      const keep = loadedAssociations.startLoad(name, ownerAttribute, key);
      return (records: readonly M[]) => {
        keep(records);
        return withBuilt(records);
      };
    },
    created(record) {
      const loaded = collection.loaded();
      // Not loaded: nothing to add to, but a load already sent mustn't land without the record.
      if (loaded === undefined) return loadedAssociations.clear(name);
      const { primaryKey } = association.target;
      loadedAssociations.set(name, ownerAttribute, joined(loaded, record, primaryKey));
    },
    built(record) {
      collection.pointBack(record);
      autosaves.addBuilt(name, record);
    },
    pointBack: (record) => pointBackAtOwner(owner, association, record),
    removed(records) {
      autosaves.removeBuilt(name, records);
      const stored = loadedAssociations.get(name)?.value as Model[] | undefined;
      // Not loaded: a load already sent mustn't land with the records.
      if (stored === undefined) return loadedAssociations.clear(name);
      const { primaryKey } = association.target;
      loadedAssociations.set(name, ownerAttribute, without(stored, records, primaryKey));
    },
    emptied() {
      autosaves.clear(name);
      loadedAssociations.set(name, ownerAttribute, []);
    },
    invalidate: () => loadedAssociations.clear(name),
    unsavedCount: () => built().filter((record) => record[state].isNew).length,
    refusal: undefined,
    nullifies: association.deletesOnDeleteAll ? undefined : definition.foreignKey,
    link: { attribute: definition.foreignKey, association: name },
    narrowed: () => narrowedOf(collection),
  };
  return collection;
}

/**
 * `loaded` with `record` added. A copy of its row, found by primary key, not identity, gives way
 * to the record itself where it stood: a read sent after the record's INSERT and answered before
 * its create finished loaded its own copy of the row (#181).
 */
function joined(loaded: readonly Model[], record: Model, primaryKey: string): Model[] {
  const index = loaded.findIndex((each) => sameRow(each, record, primaryKey));
  if (index === -1) return [...loaded, record];
  return loaded.map((each, at) => (at === index ? record : each));
}

/** `stored` without the rows of `records`. */
function without(stored: readonly Model[], records: readonly Model[], primaryKey: string) {
  return stored.filter((each) => !records.some((record) => sameRow(each, record, primaryKey)));
}

/** Whether two records hold the same row: the same primary key (a new record's none is no row). */
function sameRow(one: Model, other: Model, primaryKey: string): boolean {
  const key = one[state].read(primaryKey);
  return one === other || (key !== null && Object.is(key, other[state].read(primaryKey)));
}

/** An owner without a key: no stored records, just what was built through it. */
function withoutKey(owner: Model, association: ResolvedAssociation): AssociationCollection {
  const { name, definition } = association;
  const collection: AssociationCollection = {
    added: () => owner[state].autosaves.built(name),
    loaded: () => [...owner[state].autosaves.built(name)],
    created: () => {},
    built(record) {
      collection.pointBack(record);
      owner[state].autosaves.addBuilt(name, record);
    },
    pointBack: (record) => pointBackAtOwner(owner, association, record),
    removed: (records) => owner[state].autosaves.removeBuilt(name, records),
    emptied: () => owner[state].autosaves.clear(name),
    invalidate: () => {},
    unsavedCount: () => 0,
    refusal: association.refusalFor(owner),
    nullifies: definition.foreignKey,
    link: { attribute: definition.foreignKey, association: name },
    narrowed: () => narrowedOf(collection),
  };
  return collection;
}

/**
 * `collection`, joined with a Relation holding `other` (`or()`, `merge()`, or a scope that starts
 * a new query): a statement built or a record created through it clears `other`'s owner too,
 * since it can reach the same rows (#194). Nothing else of `other` carries over: records built or
 * created through it join only `collection`'s owner.
 */
export function alsoClearing(collection: OwnedCollection, other: OwnedCollection): OwnedCollection {
  if (other === unowned || other === collection) return collection;
  return {
    ...collection,
    created(record) {
      collection.created(record);
      other.invalidate();
    },
    invalidate() {
      collection.invalidate();
      other.invalidate();
    },
    narrowed: () => alsoClearing(collection.narrowed(), other),
  };
}

/**
 * A narrowed Relation's form: building, creating and bulk writes still reach the owner (a write
 * through a `where` can change what the owner holds); reads query.
 */
function narrowedOf(collection: OwnedCollection): OwnedCollection {
  const narrowed: OwnedCollection = {
    loaded: () => undefined,
    created: (record) => collection.created(record),
    built: (record) => collection.built(record),
    pointBack: (record) => collection.pointBack(record),
    invalidate: () => collection.invalidate(),
    unsavedCount: () => 0,
    refusal: collection.refusal,
    nullifies: undefined,
    link: collection.link,
    narrowed: () => narrowed,
  };
  return narrowed;
}
