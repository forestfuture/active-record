// `find` by primary key: one id or several, in order, keeping a Relation's conditions; `RecordNotFound` when any is missing.
import { attributeFor, noMatch } from "./attribute.ts";
import { RecordNotFound } from "./errors.ts";
import { shownKey } from "./filtering.ts";
import type { QueryRunner } from "./load.ts";
import { primaryKeyOf, type Model, type ModelClass } from "./model.ts";
import type { Condition, QueryDescription } from "./query.ts";

/** The finder rules: `query`'s conditions (plus `extra`) and includes, full rows, no order. */
function finderQuery(query: QueryDescription, extra?: Condition): QueryDescription {
  const conditions = extra === undefined ? query.conditions : [...query.conditions, extra];
  return { model: query.model, conditions, order: [], includes: query.includes };
}

/** One row `query` matches by the finder rules (plus `extra`), or null. */
export async function findOne<M extends Model>(
  runner: QueryRunner<M>,
  query: QueryDescription,
  extra?: Condition,
): Promise<M | null> {
  const [record] = await runner.load({ ...finderQuery(query, extra), limit: 1 });
  return record ?? null;
}

/** The record with primary key `id` that `query` matches, or `RecordNotFound`. */
export async function findById<M extends Model>(
  runner: QueryRunner<M>,
  query: QueryDescription,
  id: string | number,
): Promise<M> {
  const { model } = query;
  const record = await findOne(runner, query, { [model.primaryKey]: id });
  if (record === null) {
    throw new RecordNotFound(
      `${model.name} with ${model.primaryKey} ${shownKey(model, id)} not found`,
    );
  }
  return record;
}

/**
 * The records with primary keys `ids` that `query` matches, in the ids' order, or in `query`'s
 * when it has one; `RecordNotFound` if any is missing.
 */
export async function findSome<M extends Model>(
  runner: QueryRunner<M>,
  query: QueryDescription,
  ids: readonly (string | number)[],
): Promise<M[]> {
  const { model } = query;
  const records = await runner.load({
    ...finderQuery(query, { [model.primaryKey]: ids }),
    order: query.order,
  });
  if (records.length < ids.length) {
    throw new RecordNotFound(
      `Couldn't find all ${model.name} records with '${model.primaryKey}': ` +
        `(${ids.map((id) => shownKey(model, id)).join(", ")}) ` +
        `(found ${records.length} results, but was looking for ${ids.length})`,
    );
  }
  if (query.order.length > 0) return records;
  return inKeyOrder(records, ids);
}

/**
 * The primary keys `find(...)` looks up: each cast to the key's type as a condition is, then
 * each once, as Rails does. One that can't be cast stays as given, matches nothing, and is
 * reported missing.
 */
export function keysToFind(model: ModelClass, ids: readonly unknown[]): (string | number)[] {
  const key = attributeFor(model, model.primaryKey);
  const keys = ids.map((id) => {
    const cast = key.condition(id);
    return (cast === noMatch ? id : cast) as string | number;
  });
  return [...new Set(keys)];
}

/** Found `records` in the order of their primary keys in `keys`. */
function inKeyOrder<M extends Model>(records: readonly M[], keys: readonly unknown[]): M[] {
  const byKey = new Map(records.map((record) => [primaryKeyOf(record), record]));
  return keys.map((key) => byKey.get(key) as M);
}
