// Records made through a Relation: `build` and `create`, and the values they take from its conditions and owner.
import { castInherited } from "./attribute.ts";
import { RecordNotSaved, RecordNotUnique } from "./errors.ts";
import type { Executor } from "./executor.ts";
import { buildRecord, type AttributesOf, type Model, type ModelClass } from "./model.ts";
import type { CollectionWrite, OwnedCollection } from "./owned-collection.ts";
import { inheritedAttributes, type QueryDescription } from "./query.ts";

/** @internal What a Relation is made of, for the modules that write through it. */
export interface RelationState<M extends Model> {
  readonly executor: Executor;
  readonly model: ModelClass<M>;
  readonly query: QueryDescription;
  /** What a hasMany's owner already knows about it, or `unowned`. */
  readonly collection: OwnedCollection;
}

/**
 * What a record built or inserted through `relation` takes from it: its conditions' equality
 * values, then its `createWith` attributes over them, but never over its owner's key.
 */
export function inheritedValues(relation: RelationState<Model>): Record<string, unknown> {
  const { model, query, collection } = relation;
  const { link } = collection;
  const inherited = castInherited(model, inheritedAttributes(query.conditions), link);
  const given = Object.entries(query.createWith ?? {});
  const createWith = given.filter(([name]) => name !== link?.attribute);
  return { ...inherited, ...Object.fromEntries(createWith) };
}

/**
 * Throws when records can't be created or inserted through `relation`: `ReadonlyAssociation`
 * where its collection refuses `write` (#434), or, as in Rails, `RecordNotSaved` for an owner
 * with no key yet.
 */
export function requireSavedOwner(relation: RelationState<Model>, write: CollectionWrite): void {
  relation.collection.requireWritable?.(write);
  const reason = relation.collection.refusal;
  if (reason !== undefined) {
    throw new RecordNotSaved(`You cannot create a ${relation.model.name} here: ${reason}`);
  }
}

/**
 * What a new record is handed to, once its attributes are assigned and before it's saved (Rails'
 * block): `create({ email }, (user) => { user.role = "member" })`. Awaited where it's saved.
 */
export type Init<M> = (record: M) => void | Promise<void>;

/** A new, unsaved record through `relation`; through a hasMany, it joins the association. */
export function buildThrough<M extends Model>(
  relation: RelationState<M>,
  attributes: Partial<AttributesOf<M>>,
  init: ((record: M) => undefined) | undefined,
): M {
  const record = newRecord(relation, attributes);
  relation.collection.built(record);
  init?.(record);
  return record;
}

/** Builds and saves a record through `relation`; `orThrow` throws if it can't be saved. */
export async function createThrough<M extends Model>(
  relation: RelationState<M>,
  attributes: Partial<AttributesOf<M>>,
  { init, orThrow }: { init: Init<M> | undefined; orThrow: boolean },
): Promise<M> {
  const record = await recordToCreate(relation, attributes, init);
  await saveCreated(relation, record, orThrow);
  return record;
}

/**
 * Creates a record through `relation`, as `createThrough` does, or `find`s the row a unique
 * index kept it from duplicating. Only a refusal of the record's own row is found: another
 * record saved with it, refused after it was kept, throws its error.
 */
export async function createOrFindThrough<M extends Model>(
  relation: RelationState<M>,
  attributes: Partial<AttributesOf<M>>,
  options: { init: Init<M> | undefined; orThrow: boolean; find: () => Promise<M> },
): Promise<M> {
  const record = await recordToCreate(relation, attributes, options.init);
  try {
    await saveCreated(relation, record, options.orThrow);
    return record;
  } catch (error) {
    if (!isOwnRowRefused(record, error)) throw error;
    return options.find();
  }
}

/** Whether `error` is a unique index refusing `record`'s own row, so it was never written. */
function isOwnRowRefused(record: Model, error: unknown): boolean {
  if (!(error instanceof RecordNotUnique) || !record.isNewRecord()) return false;
  return error.table === (record.constructor as ModelClass).table;
}

async function recordToCreate<M extends Model>(
  relation: RelationState<M>,
  attributes: Partial<AttributesOf<M>>,
  init: Init<M> | undefined,
): Promise<M> {
  requireSavedOwner(relation, "create");
  const record = newRecord(relation, attributes);
  relation.collection.pointBack(record);
  await init?.(record);
  return record;
}

async function saveCreated(relation: RelationState<Model>, record: Model, orThrow: boolean) {
  const { collection } = relation;
  if (await saveThrough(collection, record, orThrow)) collection.created(record);
}

/** Saves a record created through `collection`, as its `saveCreated` says, or as the record saves. */
function saveThrough(
  collection: OwnedCollection,
  record: Model,
  orThrow: boolean,
): Promise<boolean> {
  const own = collection.saveCreated?.(record, orThrow);
  return own ?? (orThrow ? record.saveOrThrow() : record.save());
}

function newRecord<M extends Model>(
  relation: RelationState<M>,
  attributes: Partial<AttributesOf<M>>,
): M {
  const values = { ...inheritedValues(relation), ...attributes };
  return buildRecord(relation.model, values, relation.executor);
}
