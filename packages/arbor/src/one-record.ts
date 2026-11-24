// A Relation's one record: `first`, `last`, `take` and `sole`, from a loaded association's records or by its query.
import type { RunnableQuery } from "./load.ts";
import type { Model } from "./model.ts";
import { finderOrder, oneInOrder, onlyOne, reversed, soleIn } from "./finder-order.ts";

/** What finding one record reads: a Relation's query, and an association's loaded records. */
export interface OneRecordSource<M extends Model> extends RunnableQuery<M> {
  readonly cached: () => readonly M[] | undefined;
}

/** The first record by the Relation's order, or by primary key if it has none. */
export async function firstOf<M extends Model>(source: OneRecordSource<M>): Promise<M | null> {
  const cached = source.cached();
  if (cached !== undefined) return cached[0] ?? null;
  const { model, query, runner } = source;
  return oneInOrder(runner, query, finderOrder(model, query));
}

/**
 * The last record: the first in the reverse of every order direction. With `limit`/`offset`,
 * the last record of that page (loaded, then taken from the end).
 */
export async function lastOf<M extends Model>(source: OneRecordSource<M>): Promise<M | null> {
  const cached = source.cached();
  if (cached !== undefined) return cached.at(-1) ?? null;
  const { model, query, runner } = source;
  const order = finderOrder(model, query);
  if (query.limit !== undefined || query.offset !== undefined) {
    return (await runner.load({ ...query, order })).at(-1) ?? null;
  }
  return oneInOrder(runner, query, order.map(reversed));
}

/** One record in whatever order the database returns, or null. */
export async function takeOf<M extends Model>(source: OneRecordSource<M>): Promise<M | null> {
  const cached = source.cached();
  if (cached !== undefined) return cached[0] ?? null;
  return oneInOrder(source.runner, source.query, source.query.order);
}

/** The only record: `RecordNotFound` with none, `SoleRecordExceeded` with more than one. */
export async function soleOf<M extends Model>(source: OneRecordSource<M>): Promise<M> {
  const cached = source.cached();
  return cached === undefined ? soleIn(source.runner, source.query) : onlyOne(source.model, cached);
}
