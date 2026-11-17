// What a Relation is made of, for the modules that write through it, and what those writes take from it: its values for new rows, and whether its owner can have them.
import { castInherited } from "./attribute.ts";
import { RecordNotSaved } from "./errors.ts";
import type { Executor } from "./executor.ts";
import type { Model, ModelClass } from "./model.ts";
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
