// Batch iteration (#347): `findEach`, `findInBatches` and `inBatches`, a Relation's records a batch at a time, each batch starting after the last one's primary key.
import { gt, gte, lt, lte, type Comparison } from "./comparisons.ts";
import { IncompatibleRelation } from "./errors.ts";
import { eachOnce } from "./find.ts";
import type { QueryRunner } from "./load.ts";
import { primaryKeyOf, type Model, type ModelClass } from "./model.ts";
import type { Condition, QueryDescription } from "./query.ts";

/** What `findEach`, `findInBatches` and `inBatches` take. */
export interface IterationOptions {
  /** Records in each batch: each is one query. 1000 by default. */
  batchSize?: number;
  /** The primary key to start from, included: the smallest, or with `order: "desc"`, the largest. */
  start?: string | number;
  /** The primary key to finish at, included: the largest, or with `order: "desc"`, the smallest. */
  finish?: string | number;
  /** `"asc"` (the default) from the smallest primary key up, or `"desc"` from the largest down. */
  order?: "asc" | "desc";
}

/** A Relation's query and how it runs: what batch iteration walks through. */
export interface Iterated<M extends Model> {
  model: ModelClass<M>;
  query: QueryDescription;
  runner: QueryRunner<M>;
}

/**
 * The records `iterated` matches, in primary-key order, as arrays of up to `batchSize`. What it
 * can't follow throws now, when it's called, rather than when the first batch is read.
 */
export function recordBatches<M extends Model>(
  iterated: Iterated<M>,
  options: IterationOptions = {},
): AsyncGenerator<M[], void, undefined> {
  checkIterable(iterated);
  return batchesOf(iterated, {
    batchSize: batchSizeOf(options.batchSize),
    direction: directionOf(options.order),
    bounds: boundsOf(iterated.model.primaryKey, options),
  });
}

/** How the batches are read: their size, their direction, and `start` and `finish`. */
interface Walk {
  batchSize: number;
  direction: "asc" | "desc";
  bounds: readonly Condition[];
}

/** Each batch, until one comes back short or the Relation's limit is reached. */
async function* batchesOf<M extends Model>(
  { model, query, runner }: Iterated<M>,
  { batchSize, direction, bounds }: Walk,
): AsyncGenerator<M[], void, undefined> {
  const key = model.primaryKey;
  let left = query.limit ?? Infinity;
  let after: Condition[] = [];
  while (left > 0) {
    const limit = Math.min(batchSize, left);
    const rows = await runner.load({
      ...query,
      conditions: [...query.conditions, ...bounds, ...after],
      order: [{ attribute: key, direction }],
      limit,
    });
    // A hasMany join gives a record once per linked row, next to each other in key order.
    const records = eachOnce(rows);
    if (records.length > 0) yield records;
    if (rows.length < limit) return;
    left -= records.length;
    const last = primaryKeyOf(rows.at(-1)!);
    after = [{ [key]: direction === "asc" ? gt(last) : lt(last) }];
  }
}

/** Throws `IncompatibleRelation` for what a walk by primary key can't follow. */
function checkIterable({ model, query }: Iterated<Model>): void {
  if (query.order.length > 0) {
    throw new IncompatibleRelation(
      `${model.name}'s batches go in primary-key order, so its Relation can't have an order of its own; remove it with reorder()`,
    );
  }
  if (query.offset !== undefined) {
    throw new IncompatibleRelation(
      `${model.name}'s batches start from the primary key, not an offset; use start instead of offset()`,
    );
  }
  if (query.distinct && query.select && !query.select.includes(model.primaryKey)) {
    throw new IncompatibleRelation(
      `${model.name}'s batches follow the primary key, which distinct() with select() doesn't load; select it too`,
    );
  }
}

/** `batchSize`, 1000 by default, or a `TypeError` if it isn't a whole number from 1. */
function batchSizeOf(batchSize: number | undefined): number {
  if (batchSize === undefined) return 1000;
  if (!Number.isSafeInteger(batchSize) || batchSize < 1) {
    throw new TypeError(`batchSize must be a whole number from 1, not ${String(batchSize)}`);
  }
  return batchSize;
}

/** `order`, `"asc"` by default, or a `TypeError` if it's neither `"asc"` nor `"desc"`. */
function directionOf(order: string | undefined): "asc" | "desc" {
  if (order === undefined || order === "asc" || order === "desc") return order ?? "asc";
  throw new TypeError(`order must be "asc" or "desc", not ${JSON.stringify(order)}`);
}

/** The conditions `start` and `finish` put on the primary key, `key`, in `order`'s direction. */
function boundsOf(key: string, { start, finish, order }: IterationOptions): Condition[] {
  const [from, to] = order === "desc" ? [lte, gte] : [gte, lte];
  return [bound(key, from, start), bound(key, to, finish)].filter((c) => c !== undefined);
}

/** `key` compared with `value` by `compare`, or nothing without a value. */
function bound(
  key: string,
  compare: (value: string | number) => Comparison<string | number>,
  value: string | number | undefined,
): Condition | undefined {
  return value === undefined ? undefined : { [key]: compare(value) };
}

/** The records `iterated` matches, one at a time, loaded in batches. */
export function eachRecord<M extends Model>(
  iterated: Iterated<M>,
  options: IterationOptions = {},
): AsyncGenerator<M, void, undefined> {
  return flattened(recordBatches(iterated, options));
}

/**
 * A Relation of each batch's records, made by `relationOf`: one query reads the batch's primary
 * keys, then it's the Relation with `where({ <primary key>: keys })`, keeping its conditions so a
 * row changed since doesn't match, and without its limit, which the keys already keep to.
 */
export function relationBatches<M extends Model, R>(
  iterated: Iterated<M>,
  options: IterationOptions,
  relationOf: (query: QueryDescription) => R,
): AsyncGenerator<R, void, undefined> {
  checkIterable(iterated);
  const { model, query } = iterated;
  const keysOnly = { ...query, select: [model.primaryKey], includes: undefined };
  return relationsOf(recordBatches({ ...iterated, query: keysOnly }, options), (keys) =>
    relationOf({
      ...query,
      conditions: [...query.conditions, { [model.primaryKey]: keys.map(primaryKeyOf) }],
      limit: undefined,
    }),
  );
}

/** Each batch's Relation. */
async function* relationsOf<M extends Model, R>(
  batches: AsyncIterable<M[]>,
  relationOf: (records: M[]) => R,
): AsyncGenerator<R, void, undefined> {
  for await (const records of batches) yield relationOf(records);
}

/** Each record of each batch. */
async function* flattened<M>(batches: AsyncIterable<M[]>): AsyncGenerator<M, void, undefined> {
  for await (const records of batches) yield* records;
}
