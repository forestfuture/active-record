// Batch iteration (#347): `findEach`, `findInBatches` and `inBatches`, a Relation's records a batch at a time, each batch starting after the last one's primary key.
import { gt } from "./comparisons.ts";
import type { QueryRunner } from "./load.ts";
import { primaryKeyOf, type Model, type ModelClass } from "./model.ts";
import type { Condition, QueryDescription } from "./query.ts";

/** What `findEach`, `findInBatches` and `inBatches` take. */
export interface IterationOptions {
  /** Records in each batch: each is one query. 1000 by default. */
  batchSize?: number;
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
  const key = model.primaryKey;
  let after: Condition[] = [];
  for (;;) {
    const records = await runner.load({
      ...query,
      conditions: [...query.conditions, ...after],
      order: [{ attribute: key, direction: "asc" }],
      limit: batchSize,
    });
    if (records.length > 0) yield records;
    if (records.length < batchSize) return;
    after = [{ [key]: gt(primaryKeyOf(records.at(-1)!)) }];
  }
}

/** The records `iterated` matches, one at a time, loaded in batches. */
export async function* eachRecord<M extends Model>(
  iterated: Iterated<M>,
  options: IterationOptions = {},
): AsyncGenerator<M, void, undefined> {
  for await (const records of recordBatches(iterated, options)) yield* records;
}
