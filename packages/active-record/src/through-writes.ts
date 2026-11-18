// Writing through a through association (#434): the join records that link its owner to its records, created and removed.
import type { HasOne, ThroughDependent } from "./associations.ts";
import {
  hasOneAccessor,
  pointOwnerAt,
  requireSettable,
  undoPointing,
} from "./association-writers.ts";
import { forget } from "./autosave.ts";
import { RecordNotSaved } from "./errors.ts";
import { requireTargets, saveTogether, type CollectionMethods } from "./collection-methods.ts";
import { destroyTogether } from "./records-together.ts";
import { refusalError, saveLifecycle, type Outcome } from "./lifecycle.ts";
import type { Model, ModelClass } from "./model.ts";
import {
  ownedCollection,
  type AssociationCollection,
  type OwnedCollection,
  type CollectionWrite,
} from "./owned-collection.ts";
import { state } from "./record-state.ts";
import { queryOf, type Relation, type Scoped } from "./relation.ts";
import { preparedWrites } from "./prepared-writes.ts";
import type { QueryDescription } from "./query.ts";
import { countedOut } from "./owners-counter.ts";
import { runAlone, Statement, statementParts } from "./statement.ts";
import { linkedToRecords, type ResolvedAssociation } from "./resolved-association.ts";
import { insertError, requireWritableThrough } from "./through-associations.ts";

/** An owner's through hasMany, as its collection methods use it. */
export interface OwnersHasManyThrough {
  owner: Model;
  association: ResolvedAssociation;
  /** What the owner holds of it. */
  collection: AssociationCollection;
  /** Its Relation, whose own `deleteAll()` deletes the owner's join records. */
  relation: { deleteAll(): Promise<number>; toArray(): Promise<Model[]> };
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
    requireWritableThrough(through.association);
    collection.built(record);
    joinFor(through, record);
  };
  const requireWritable = (write: CollectionWrite) => {
    if (write === "insert") throw insertError(through.association);
    requireWritableThrough(through.association);
  };
  const saveCreated = (record: Model, orThrow: boolean) => saveWithJoin(through, record, orThrow);
  const deleteAllOf = (query: QueryDescription) => deleteJoins(through, collection, query);
  // A narrowed one's deleteAll deletes the records it finds, as any Relation's.
  const narrowed = (): OwnedCollection => ({
    ...collection.narrowed(),
    built,
    saveCreated,
    requireWritable,
    narrowed,
  });
  return { ...collection, built, saveCreated, requireWritable, deleteAllOf, narrowed };
}

/** A through hasMany's collection methods (#434): each writes its join records. */
export function throughCollectionMethods<M extends Model>(
  hasMany: OwnersHasManyThrough,
): CollectionMethods<M> {
  return {
    push: (...records) => push(hasMany, records),
    delete: (...records) => remove(hasMany, records, removalOf(hasMany.association)),
    destroy: (...records) => remove(hasMany, records, "destroy"),
    clear: () => clear(hasMany),
    destroyAll: () => destroyAll(hasMany),
  };
}

/**
 * Links the owner to each record with a new join record, as Rails' `<<` does: built through
 * the association it goes through, pointing at the record, then saved together, each saving
 * its record first if that's new. Resolves to `false`, with nothing written, if one can't be.
 */
async function push(hasMany: OwnersHasManyThrough, records: Model[]): Promise<boolean> {
  const { owner, association, collection } = hasMany;
  requireWritableThrough(association);
  requireTargets(association, records);
  for (const record of records) record[state].requireLive("be saved");
  // A new owner saves them with it: their join records, each saving its record first.
  if (owner[state].isNew) {
    for (const record of records) collection.built(record);
    return true;
  }
  const joins = records.map((record) => joinFor(hasMany, record));
  const viaCollection = joinsHeldBy(owner, association);
  const save = () => saveTogether(joins, "push() needs its records");
  if (!(await undoneUnless(save, isTrue, () => viaCollection.removed(joins)))) return false;
  for (const join of joins) viaCollection.created(join);
  for (const record of records) collection.created(record);
  return true;
}

/** How `delete` removes join records: by the association's `dependent:`, deleting by default. */
function removalOf({ definition: { dependent } }: ResolvedAssociation): ThroughDependent {
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
  const joinRecords = via.linkedTo(executor, via.keyOf(owner));
  return linkedToRecords(
    joinRecords,
    source.ownerAttribute,
    reached[queryOf],
    source.targetAttribute,
  );
}

/**
 * Takes every record out of the association, as its own `deleteAll()` does: the owner's join
 * records to them are deleted, without callbacks, and it forgets those built through it, so it
 * reads as empty without a query.
 */
async function clear({ owner, association, collection, relation }: OwnersHasManyThrough) {
  requireWritableThrough(association);
  const viaCollection = joinsHeldBy(owner, association);
  viaCollection.removed(
    builtJoins(viaCollection.added(), association.hops!.source, collection.added()),
  );
  if (!owner[state].isNew) await relation.deleteAll();
  collection.emptied();
}

/**
 * Destroys the owner's join records to every record the association holds, callbacks included,
 * as Rails' `destroy_all` does through a join Model, and resolves to the records, which stay. It
 * then reads as empty without a query.
 */
async function destroyAll<M extends Model>(hasMany: OwnersHasManyThrough): Promise<M[]> {
  requireWritableThrough(hasMany.association);
  const records = (await hasMany.relation.toArray()) as M[];
  await remove(hasMany, records, "destroy", "destroyAll");
  hasMany.collection.emptied();
  return records;
}

/**
 * The statement that deletes the owner's join records to the records `query` finds: those of
 * the association it goes through whose source key is one of theirs.
 */
function deleteJoins(
  { owner, association, via }: ThroughOwner,
  collection: OwnedCollection,
  query: QueryDescription,
): Statement {
  requireWritableThrough(association);
  const { source } = association.hops!;
  const joins = linkedToRecords(via(), source.ownerAttribute, query, source.targetAttribute);
  const { executor, queries, landed } = joins[preparedWrites].deleteAll()[statementParts];
  // What the owner has loaded through it is no longer known, as for any write through it (#187).
  collection.invalidate();
  const statement = new Statement(executor, queries, (results) => {
    landed(results);
    collection.invalidate();
  });
  return countedOutJoins(statement, { owner, association }, joins[queryOf]);
}

/**
 * `statement`, deleting the owner's join records `query` finds, with the owner's counter cache
 * of them counting them out, as Rails' has_many :through does (#61).
 */
function countedOutJoins(
  statement: Statement,
  { owner, association }: Pick<ThroughOwner, "owner" | "association">,
  query: QueryDescription,
): Statement {
  return countedOut(statement, owner, association.hops!.via, query);
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
  removal: ThroughDependent,
  method = removal === "destroy" ? "destroy" : "delete",
): Promise<M[]> {
  const { owner, association, collection, via } = hasMany;
  requireWritableThrough(association);
  requireTargets(association, records);
  const { source } = association.hops!;
  const viaCollection = joinsHeldBy(owner, association);
  viaCollection.removed(builtJoins(viaCollection.added(), source, records));
  const stored = owner[state].isNew ? [] : records.filter((record) => !record[state].isNew);
  if (stored.length > 0) {
    const keys = stored.map((record) => record[state].read(source.targetAttribute));
    // Narrowed from the association's Relation, so its deleteAll deletes rather than nullifying.
    const joins = via().where({ [source.ownerAttribute]: keys } as never);
    if (removal === "deleteAll") {
      const statement = joins[preparedWrites].deleteAll();
      await runAlone(countedOutJoins(statement, hasMany, joins[queryOf]));
    } else
      await destroyJoins(viaCollection, await joins.toArray(), `${method}() needs its records`);
  }
  collection.removed(records);
  return records;
}

/**
 * Destroys `joins` in one write, then takes them out of what the owner has loaded of the
 * association it goes through: they were loaded on their own, so its copies are left over.
 */
async function destroyJoins(viaCollection: AssociationCollection, joins: Model[], needs: string) {
  await destroyTogether(joins, needs);
  viaCollection.removed(joins);
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
  const viaCollection = joinsHeldBy(through.owner, through.association);
  const saved = ({ status }: Outcome) => status === "saved";
  const outcome = await undoneUnless(
    () => saveLifecycle(join),
    saved,
    () => viaCollection.removed([join]),
  );
  if (outcome.status === "saved") {
    viaCollection.created(join);
    return true;
  }
  if (!orThrow) return false;
  throw refusalError(record[state].errors.isEmpty() ? join : record, outcome, "save");
}

/**
 * Runs `run`, then `undo` unless `succeeded` says it did, or if it throws: a refused or failed
 * write leaves the owner as it was.
 */
async function undoneUnless<T>(
  run: () => Promise<T>,
  succeeded: (result: T) => boolean,
  undo: () => void,
): Promise<T> {
  let done = false;
  try {
    const result = await run();
    done = succeeded(result);
    return result;
  } finally {
    if (!done) undo();
  }
}

/** Whether a save resolved to `true`. */
const isTrue = (saved: boolean): boolean => saved;

/** What `owner` holds of the association `association` goes through: its join records. */
function joinsHeldBy(owner: Model, association: ResolvedAssociation): AssociationCollection {
  return ownedCollection(owner, association.hops!.via);
}

/** A new join record, built through the association it goes through, pointing at `record`. */
function joinFor({ association, via }: ThroughOwner, record: Model): Model {
  const join = via().build();
  pointOwnerAt(join, association.hops!.source, record);
  return join;
}

/** A through hasOne's accessor (#434): it reads its record, and `set` links the owner to another. */
export function throughHasOne(
  read: () => Promise<unknown>,
  owner: Model,
  association: ResolvedAssociation,
) {
  const set = (record: Model | null) => setThrough(owner, association, record);
  return Object.assign(read, { set });
}

/**
 * A through hasOne's `set`, as Rails' `has_one :through` writer: points the owner's join record
 * at `record`, saving it, or builds one through the association it goes through (saved now, or
 * with a new owner); `null` destroys the join record. A join record that can't be saved throws
 * `RecordNotSaved`, and one built for it is forgotten.
 */
async function setThrough(
  owner: Model,
  association: ResolvedAssociation,
  record: Model | null,
): Promise<void> {
  const { name, ownerAttribute } = association;
  requireWritableThrough(association);
  requireSettable(association, record);
  const { via, source } = association.hops!;
  const viaOne = hasOneAccessor(owner, via) as HasOne<ModelClass>;
  const join = await viaOne();
  if (record === null) {
    if (join !== null) await removeJoin(owner, via, join);
  } else {
    const linked = join ?? viaOne.build();
    // A refused save undoes the set: a join record built for it is forgotten, and an existing
    // one points where it did.
    const undo = join === null ? () => forget(owner, via, linked) : undoPointing(linked, source);
    pointOwnerAt(linked, source, record);
    if (!owner[state].isNew && !(await undoneUnless(() => linked.save(), isTrue, undo))) {
      throw new RecordNotSaved(`Failed to save the new associated ${via.name}`);
    }
  }
  owner[state].associations.set(name, ownerAttribute, record);
}

/** Destroys the owner's join record (one not saved yet is just forgotten), as Rails does. */
async function removeJoin(owner: Model, via: ResolvedAssociation, join: Model): Promise<void> {
  if (!join[state].isNew) await join.destroyOrThrow();
  forget(owner, via, join);
}
