// Batch iteration (#347): `findEach`, `findInBatches` and `inBatches`, a Relation's records a batch at a time, each batch starting after the last one's primary key.
import { gt, gte, lt, lte, type Comparison } from "./comparisons.ts";
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

/** The records `iterated` matches, in primary-key order, as arrays of up to `batchSize`. */
export async function* recordBatches<M extends Model>(
  { model, query, runner }: Iterated<M>,
  options: IterationOptions = {},
): AsyncGenerator<M[], void, undefined> {
  const batchSize = options.batchSize ?? 1000;
  const direction = options.order ?? "asc";
  const key = model.primaryKey;
  const bounds = boundsOf(key, options);
  let after: Condition[] = [];
  for (;;) {
    const records = await runner.load({
      ...query,
      conditions: [...query.conditions, ...bounds, ...after],
      order: [{ attribute: key, direction }],
      limit: batchSize,
    });
    if (records.length > 0) yield records;
    if (records.length < batchSize) return;
    const last = primaryKeyOf(records.at(-1)!);
    after = [{ [key]: direction === "asc" ? gt(last) : lt(last) }];
  }
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
export async function* eachRecord<M extends Model>(
  iterated: Iterated<M>,
  options: IterationOptions = {},
): AsyncGenerator<M, void, undefined> {
  for await (const records of recordBatches(iterated, options)) yield* records;
}
