// `find` by primary key: one id or several, in order, keeping a Relation's conditions; `RecordNotFound` when any is missing.
import { attributeFor, noMatch } from "./attribute.ts";
import { RecordNotFound } from "./errors.ts";
import { shownKey } from "./filtering.ts";
import type { QueryRunner, RunnableQuery } from "./load.ts";
import { primaryKeyOf, type Model, type ModelClass } from "./model.ts";
import type { Condition, QueryDescription } from "./query.ts";

/**
 * The finder rules: `query`'s conditions (plus `extra`), joins and includes, full rows, no
 * order.
 */
function finderQuery(query: QueryDescription, extra?: Condition): QueryDescription {
  const conditions = extra === undefined ? query.conditions : [...query.conditions, extra];
  const { model, joins, includes } = query;
  return { model, conditions, order: [], includes, ...(joins !== undefined && { joins }) };
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
async function findById<M extends Model>(
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
async function findSome<M extends Model>(
  runner: QueryRunner<M>,
  query: QueryDescription,
  ids: readonly (string | number)[],
): Promise<M[]> {
  const { model } = query;
  const loaded = await runner.load({
    ...finderQuery(query, { [model.primaryKey]: ids }),
    order: query.order,
  });
  // A hasMany join finds a record once for each linked record (#24): each is found once.
  const records = eachOnce(loaded);
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
 * each once. One that can't be cast stays as given, matches nothing, and is
 * reported missing.
 */
function keysToFind(model: ModelClass, ids: readonly unknown[]): (string | number)[] {
  const key = attributeFor(model, model.primaryKey);
  const keys = ids.map((id) => {
    const cast = key.condition(id);
    return (cast === noMatch ? id : cast) as string | number;
  });
  return [...new Set(keys)];
}

/** `records` without a later one with the same primary key: a join's repeated rows. */
export function eachOnce<M extends Model>(records: readonly M[]): M[] {
  const seen = new Set<unknown>();
  return records.filter((record) => {
    const key = primaryKeyOf(record);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Found `records` in the order of their primary keys in `keys`. */
function inKeyOrder<M extends Model>(records: readonly M[], keys: readonly unknown[]): M[] {
  const byKey = new Map(records.map((record) => [primaryKeyOf(record), record]));
  return keys.map((key) => byKey.get(key) as M);
}

/** What `find(...args)` finds: one record for one id, else an array, in the ids' or the query's order. */
export async function findByIds<M extends Model>(
  { model, query, runner }: RunnableQuery<M>,
  args: readonly (string | number | readonly (string | number)[])[],
): Promise<M | M[]> {
  const [only] = args;
  if (args.length === 1 && (typeof only === "string" || typeof only === "number")) {
    return findById(runner, query, only);
  }
  const ids = keysToFind(model, args.flat());
  return ids.length === 0 ? [] : findSome(runner, query, ids);
}
