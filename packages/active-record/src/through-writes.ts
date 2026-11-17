// Writing through a through association (#434): the join records that link its owner to its records, created and removed.
import { pointOwnerAt } from "./association-writers.ts";
import { requireTargets, saveTogether, type CollectionMethods } from "./collection-methods.ts";
import type { Model } from "./model.ts";
import {
  ownedCollection,
  type AssociationCollection,
  type OwnedCollection,
  type Write,
} from "./owned-collection.ts";
import { state } from "./record-state.ts";
import type { ResolvedAssociation } from "./resolved-association.ts";
import { readonlyError } from "./through-associations.ts";

/** An owner's through hasMany, as its collection methods use it. */
export interface OwnersHasManyThrough {
  owner: Model;
  association: ResolvedAssociation;
  /** What the owner holds of it. */
  collection: AssociationCollection;
  /** The Relation of the association it goes through, whose `build` makes a join record. */
  via: () => { build(): Model };
}

/** What a through hasMany needs to write its join records: its owner, and its hops' Relation. */
export type ThroughOwner = Omit<OwnersHasManyThrough, "collection">;

/**
 * A through hasMany's collection, as its owner holds it: a record built through it gets a join
 * record, built through the association it goes through, that points at it; the writes it
 * can't make (inserting records, creating them, and its own `deleteAll()`) throw
 * `ReadonlyAssociation`. A narrowed one's builds the same way, and its `deleteAll()` deletes
 * the records themselves, as any Relation's does.
 */
export function throughCollection(through: ThroughOwner): AssociationCollection {
  const collection = ownedCollection(through.owner, through.association);
  const built = (record: Model) => {
    collection.built(record);
    joinFor(through, record);
  };
  const refuse = (write: Write) => {
    if (write !== "build") throw readonlyError(through.association);
  };
  const narrowed = (): OwnedCollection => ({
    ...collection.narrowed(),
    built,
    requireWritable: (write) => (write === "deleteAll" ? undefined : refuse(write)),
    narrowed,
  });
  return { ...collection, built, requireWritable: refuse, narrowed };
}

/** A through hasMany's collection methods (#434): each writes its join records. */
export function throughCollectionMethods<M extends Model>(
  hasMany: OwnersHasManyThrough,
): CollectionMethods<M> {
  const refuse = () => Promise.reject(readonlyError(hasMany.association));
  return {
    push: (...records) => push(hasMany, records),
    delete: refuse,
    destroy: refuse,
    clear: refuse,
    destroyAll: refuse,
  };
}

/**
 * Links the owner to each record with a new join record, as Rails' `<<` does: built through
 * the association it goes through, pointing at the record, then saved together, each saving
 * its record first if that's new. Resolves to `false`, with nothing written, if one can't be.
 */
async function push(hasMany: OwnersHasManyThrough, records: Model[]): Promise<boolean> {
  const { owner, association, collection } = hasMany;
  requireTargets(association, records);
  for (const record of records) record[state].requireLive("be saved");
  // A new owner saves them with it: their join records, each saving its record first.
  if (owner[state].isNew) {
    for (const record of records) collection.built(record);
    return true;
  }
  const joins = records.map((record) => joinFor(hasMany, record));
  const viaCollection = ownedCollection(owner, association.hops!.via);
  if (!(await saveTogether(joins, "push() needs its records"))) {
    viaCollection.removed(joins);
    return false;
  }
  for (const join of joins) viaCollection.created(join);
  for (const record of records) collection.created(record);
  return true;
}

/** A new join record, built through the association it goes through, pointing at `record`. */
function joinFor({ association, via }: ThroughOwner, record: Model): Model {
  const join = via().build();
  pointOwnerAt(join, association.hops!.source, record);
  return join;
}
