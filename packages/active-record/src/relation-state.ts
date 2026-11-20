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
 * @internal The values of a record built or created through `relation`, given `given`: its
 * conditions' equality values, then its `createWith` attributes, then the given ones, with its
 * owner's key over them all, set last: the owner's own, whatever the
 * conditions say, so a narrowed, merged or `or()`ed hasMany gives it too.
 */
export function builtRecordValues(
  relation: RelationState<Model>,
  given: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return { ...scopeValues(relation), ...given, ...ownersValues(relation) };
}

/**
 * @internal The values of a row a bulk write (`insert`, `upsert` and their `All` forms) writes
 * through `relation`, given `given`: the given ones, then its conditions' equality values, then
 * its `createWith` attributes, then its owner's, so the scope's values go over each
 * row's (#470), where `build` and `create` take the given ones over them.
 */
export function bulkRowValues(
  relation: RelationState<Model>,
  given: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return { ...given, ...scopeValues(relation), ...ownersValues(relation) };
}

/** `relation`'s values for a new row: its conditions' equality values, its `createWith` over them. */
function scopeValues({ model, query, collection }: RelationState<Model>): Record<string, unknown> {
  const inherited = castInherited(model, inheritedAttributes(query.conditions), collection.link);
  return { ...inherited, ...query.createWith };
}

/**
 * @internal What a row built or inserted through `relation` takes from its owner over any
 * other value: the owner's key, and a polymorphic hasMany's type (#451); none without an owner,
 * or through another association.
 */
export function ownersValues({ model, collection }: RelationState<Model>): Record<string, unknown> {
  const { link } = collection;
  if (link === undefined || !("key" in link)) return {};
  const type = link.type === undefined ? {} : { [link.type.attribute]: link.type.value };
  return { ...castInherited(model, { [link.attribute]: link.key }, link), ...type };
}

/**
 * @internal Throws when records can't be created or inserted through `relation`:
 * `ReadonlyAssociation` where its collection refuses `write` (#434), or
 * `RecordNotSaved` for an owner with no key yet.
 */
export function requireSavedOwner(relation: RelationState<Model>, write: CollectionWrite): void {
  relation.collection.requireWritable?.(write);
  const reason = relation.collection.refusal;
  if (reason !== undefined) {
    throw new RecordNotSaved(`You cannot create a ${relation.model.name} here: ${reason}`);
  }
}
