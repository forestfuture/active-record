// Records made through a Relation: `build`, `create`, `findOrInitializeBy`'s build and `createOrFindBy`'s create, each handed to its `init`.
import { RecordNotUnique } from "./errors.ts";
import { runBuiltCallbacks } from "./load-callbacks.ts";
import { refuseThenable } from "./thenables.ts";
import { buildRecord, type AttributesOf, type Model, type ModelClass } from "./model.ts";
import type { OwnedCollection } from "./owned-collection.ts";
import { state } from "./record-state.ts";
import { builtRecordValues, requireSavedOwner, type RelationState } from "./relation-state.ts";

/**
 * What a new record is handed to, once its attributes are assigned and before it's saved:
 * `create({ email }, (user) => { user.role = "member" })`. Awaited where it's saved.
 */
export type Init<M> = (record: M) => void | Promise<void>;

/**
 * @internal A new, unsaved record through `relation`, handed to `init`, which mustn't return a promise
 * (`TypeError`): nothing awaits it. Through a hasMany, the record then joins the association,
 * so a record whose `init` throws doesn't.
 */
export function buildThrough<M extends Model>(
  relation: RelationState<M>,
  attributes: Partial<AttributesOf<M>>,
  init: ((record: M) => void) | undefined,
): M {
  const record = recordToBuild(relation, attributes);
  refuseInitPromise(relation.model, init?.(record));
  runBuiltCallbacks(record);
  relation.collection.built(record);
  return record;
}

/** Throws `TypeError` if a `build` `init` returned a promise, which `build` can't await. */
function refuseInitPromise(model: ModelClass, result: unknown): void {
  refuseThenable(
    result,
    `${model.name}.build(): init returned a promise, which build can't await; findOrInitializeBy and create await it`,
  );
}

/** @internal `buildThrough`, awaiting `init`: what `findOrInitializeBy` builds. */
export async function initializeThrough<M extends Model>(
  relation: RelationState<M>,
  attributes: Partial<AttributesOf<M>>,
  init: Init<M> | undefined,
): Promise<M> {
  const record = recordToBuild(relation, attributes);
  await init?.(record);
  runBuiltCallbacks(record);
  relation.collection.built(record);
  return record;
}

/** @internal Builds and saves a record through `relation`; `orThrow` throws if it can't be saved. */
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
 * @internal Creates a record through `relation`, as `createThrough` does, or `find`s the row a unique
 * index kept it from duplicating. It finds only for a record saved alone: when `init` gave it
 * records to save with it, a refusal may be theirs, so any `RecordNotUnique` reaches the caller.
 */
export async function createOrFindThrough<M extends Model>(
  relation: RelationState<M>,
  attributes: Partial<AttributesOf<M>>,
  options: { init: Init<M> | undefined; orThrow: boolean; find: () => Promise<M> },
): Promise<M> {
  const record = await recordToCreate(relation, attributes, options.init);
  const isSavedAlone = record[state].autosaves.isEmpty();
  try {
    await saveCreated(relation, record, options.orThrow);
    return record;
  } catch (error) {
    if (!isSavedAlone || !(error instanceof RecordNotUnique)) throw error;
    return options.find();
  }
}

async function recordToCreate<M extends Model>(
  relation: RelationState<M>,
  attributes: Partial<AttributesOf<M>>,
  init: Init<M> | undefined,
): Promise<M> {
  requireSavedOwner(relation, "create");
  const record = recordToBuild(relation, attributes);
  await init?.(record);
  runBuiltCallbacks(record);
  return record;
}

/** A new record through `relation`, pointing back at its owner if it has one. */
function recordToBuild<M extends Model>(
  relation: RelationState<M>,
  attributes: Partial<AttributesOf<M>>,
): M {
  const record = newRecord(relation, attributes);
  relation.collection.pointBack(record);
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
  return buildRecord(relation.model, builtRecordValues(relation, attributes), relation.executor);
}
