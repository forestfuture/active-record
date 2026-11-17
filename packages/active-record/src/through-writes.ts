// Writing through a through association (#434): the join records that link its owner to its records, created and removed.
import { pointOwnerAt } from "./association-writers.ts";
import { requireTargets, saveTogether, type CollectionMethods } from "./collection-methods.ts";
import { destroyTogether } from "./records-together.ts";
import { refusalError, saveLifecycle } from "./lifecycle.ts";
import type { Model } from "./model.ts";
import {
  ownedCollection,
  type AssociationCollection,
  type OwnedCollection,
  type Write,
} from "./owned-collection.ts";
import { state } from "./record-state.ts";
import { linkedToRecordsOf, queryOf, type Relation, type Scoped } from "./relation.ts";
import { preparedWrites } from "./prepared-writes.ts";
import type { QueryDescription } from "./query.ts";
import { Statement, statementParts } from "./statement.ts";
import type { ResolvedAssociation } from "./resolved-association.ts";
import { readonlyError } from "./through-associations.ts";

/** An owner's through hasMany, as its collection methods use it. */
export interface OwnersHasManyThrough {
  owner: Model;
  association: ResolvedAssociation;
  /** What the owner holds of it. */
  collection: AssociationCollection;
  /** Its Relation, whose own `deleteAll()` deletes the owner's join records. */
  relation: { deleteAll(): Promise<number> };
  /** The owner's Relation of the association it goes through, of its join records. */
  via: () => Relation<Model>;
}

/** What a through hasMany needs to write its join records: its owner, and its hops' Relation. */
export type ThroughOwner = Omit<OwnersHasManyThrough, "collection" | "relation">;

/**
 * A through hasMany's collection, as its owner holds it: a record built through it gets a join
 * record, built through the association it goes through, that points at it, and one created
 * through it is saved with it. Its own `deleteAll()` deletes the owner's join records to the
 * records it reaches, as Rails' does, where a narrowed one's deletes the records themselves, as
 * any Relation's does. Inserting records through it throws `ReadonlyAssociation`.
 */
export function throughCollection(through: ThroughOwner): AssociationCollection {
  const collection = ownedCollection(through.owner, through.association);
  const built = (record: Model) => {
    collection.built(record);
    joinFor(through, record);
  };
  const refuse = (write: Write) => {
    if (write === "insert") throw readonlyError(through.association);
  };
  const saveCreated = (record: Model, orThrow: boolean) => saveWithJoin(through, record, orThrow);
  const deleteAllOf = (query: QueryDescription) => deleteJoins(through, collection, query);
  const narrowed = (): OwnedCollection => ({
    ...collection.narrowed(),
    built,
    saveCreated,
    requireWritable: refuse,
    narrowed,
  });
  return { ...collection, built, saveCreated, requireWritable: refuse, deleteAllOf, narrowed };
}

/** A through hasMany's collection methods (#434): each writes its join records. */
export function throughCollectionMethods<M extends Model>(
  hasMany: OwnersHasManyThrough,
): CollectionMethods<M> {
  const refuse = () => Promise.reject(readonlyError(hasMany.association));
  return {
    push: (...records) => push(hasMany, records),
    delete: (...records) => remove(hasMany, records, removalOf(hasMany.association)),
    destroy: (...records) => remove(hasMany, records, "destroy"),
    clear: () => clear(hasMany),
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

/** How `delete` removes join records: by the association's `dependent:`, deleting by default. */
function removalOf({ definition: { dependent } }: ResolvedAssociation): "destroy" | "deleteAll" {
  return dependent === "destroy" ? "destroy" : "deleteAll";
}

/**
 * The owner's join records to the records the association reaches, which its `dependent:` acts
 * on when the owner is destroyed (#434): those of the association it goes through whose source
 * key is one of theirs.
 */
export function joinRecordsOf(owner: Model, association: ResolvedAssociation): Scoped<Model> {
  const { via, source } = association.hops!;
  const { executor } = owner[state];
  const reached = association.linkedTo(executor, association.keyOf(owner));
  return via
    .linkedTo(executor, via.keyOf(owner))
    [linkedToRecordsOf](source.ownerAttribute, reached[queryOf], source.targetAttribute);
}

/**
 * Takes every record out of the association, as its own `deleteAll()` does: the owner's join
 * records to them are deleted, without callbacks, and it forgets those built through it, so it
 * reads as empty without a query.
 */
async function clear({ owner, association, collection, relation }: OwnersHasManyThrough) {
  const viaCollection = ownedCollection(owner, association.hops!.via);
  viaCollection.removed(
    builtJoins(viaCollection.added(), association.hops!.source, collection.added()),
  );
  if (!owner[state].isNew) await relation.deleteAll();
  collection.emptied();
}

/**
 * The statement that deletes the owner's join records to the records `query` finds: those of
 * the association it goes through whose source key is one of theirs.
 */
function deleteJoins(
  { association, via }: ThroughOwner,
  collection: OwnedCollection,
  query: QueryDescription,
): Statement {
  const { source } = association.hops!;
  const joins = via()[linkedToRecordsOf](source.ownerAttribute, query, source.targetAttribute);
  const { executor, queries, landed } = joins[preparedWrites].deleteAll()[statementParts];
  // What the owner has loaded through it is no longer known, as for any write through it (#187).
  collection.invalidate();
  return new Statement(executor, queries, () => {
    landed();
    collection.invalidate();
  });
}

/**
 * Takes records out of the association, as Rails' `delete` and `destroy` do through a join
 * Model: removes the owner's join records that point at them, as `removal` says (`"destroy"`
 * runs their callbacks, in one write that a refusal stops whole), and forgets those built
 * through it. The records themselves stay; one the owner doesn't reach removes nothing.
 */
async function remove<M extends Model>(
  hasMany: OwnersHasManyThrough,
  records: M[],
  removal: "destroy" | "deleteAll",
): Promise<M[]> {
  const { owner, association, collection, via } = hasMany;
  requireTargets(association, records);
  const { via: viaAssociation, source } = association.hops!;
  const viaCollection = ownedCollection(owner, viaAssociation);
  viaCollection.removed(builtJoins(viaCollection.added(), source, records));
  const stored = owner[state].isNew ? [] : records.filter((record) => !record[state].isNew);
  if (stored.length > 0) {
    const keys = stored.map((record) => record[state].read(source.targetAttribute));
    // Narrowed from the association's Relation, so its deleteAll deletes rather than nullifying.
    const joins = via().where({ [source.ownerAttribute]: keys } as never);
    if (removal === "deleteAll") await joins.deleteAll();
    else await destroyTogether(await joins.toArray(), `${removal}() needs its records`);
  }
  collection.removed(records);
  return records;
}

/** The join records among `joins` that point at one of `records` through `source`. */
function builtJoins(
  joins: readonly Model[],
  source: ResolvedAssociation,
  records: readonly Model[],
): Model[] {
  return joins.filter((join) => {
    const pointedAt = join[state].associations.get(source.name)?.value;
    return records.includes(pointedAt as Model);
  });
}

/**
 * Saves a record created through the association with a new join record pointing at it: the
 * join record's save, which saves the record first. Refused, the join record is forgotten, and
 * with `orThrow` it throws as `saveOrThrow` does, for the record if it was the one refused.
 */
async function saveWithJoin(
  through: ThroughOwner,
  record: Model,
  orThrow: boolean,
): Promise<boolean> {
  const join = joinFor(through, record);
  const outcome = await saveLifecycle(join);
  if (outcome.status === "saved") {
    ownedCollection(through.owner, through.association.hops!.via).created(join);
    return true;
  }
  ownedCollection(through.owner, through.association.hops!.via).removed([join]);
  if (!orThrow) return false;
  throw refusalError(record[state].errors.isEmpty() ? join : record, outcome, "save");
}

/** A new join record, built through the association it goes through, pointing at `record`. */
function joinFor({ association, via }: ThroughOwner, record: Model): Model {
  const join = via().build();
  pointOwnerAt(join, association.hops!.source, record);
  return join;
}
