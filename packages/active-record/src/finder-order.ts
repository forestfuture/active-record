// The order and limit a finder (`first`, `last`, `take`, `sole`) applies, what it throws when it finds none or more than one, the order a page keeps, and the order an owner's collection loads in.
import { IrreversibleOrder, RecordNotFound, SoleRecordExceeded } from "./errors.ts";
import type { QueryRunner } from "./load.ts";
import type { Model, ModelClass } from "./model.ts";
import {
  JoinedOrder,
  type AttributeOrder,
  type OrderTerm,
  type QueryDescription,
} from "./query.ts";
import { SafeSql } from "./sql.ts";

/** The same term sorting the other way; NULLs move to the other end too, as in Rails. */
export function reversed(term: OrderTerm): OrderTerm {
  return term instanceof JoinedOrder
    ? new JoinedOrder(term.path, reversedTerm(term.term))
    : reversedTerm(term);
}

/** An attribute's or a fragment's term, reversed. */
function reversedTerm(term: AttributeOrder | SafeSql): AttributeOrder | SafeSql {
  if (term instanceof SafeSql) {
    throw new IrreversibleOrder(
      "last() can't reverse an order given as an sql fragment; order by attributes, or reverse the fragment yourself and use first()",
    );
  }
  const direction = term.direction === "asc" ? "desc" : "asc";
  const nulls = term.nulls && (term.nulls === "first" ? "last" : "first");
  return { ...term, direction, ...(nulls && { nulls }) };
}

/** Up to `rows` records from the page: `limit(0)` stays empty, and `offset` is kept by the caller. */
function atMost(rows: number, limit: number | undefined): number {
  return Math.min(limit ?? rows, rows);
}

/** One record from the page, as `atMost` takes it. */
export function atMostOne(limit: number | undefined): number {
  return atMost(1, limit);
}

/**
 * `query`'s order, ended with what makes a row unique, so tied rows keep their pages between
 * requests: the primary key, or after `distinct()`, the selected attributes (the key isn't
 * loaded). Those already in the order aren't added again.
 */
export function stableOrder(model: ModelClass, query: QueryDescription): readonly OrderTerm[] {
  const unique = query.distinct && query.select ? query.select : [model.primaryKey];
  const ordered = new Set(
    query.order.map(
      (term) => !(term instanceof SafeSql) && !(term instanceof JoinedOrder) && term.attribute,
    ),
  );
  const ties = unique
    .filter((attribute) => !ordered.has(attribute))
    .map((attribute) => ({ attribute, direction: "asc" as const }));
  return [...query.order, ...ties];
}

/** `query`'s order, then the primary key ascending, so ties come back the same way. */
export function thenPrimaryKey(model: ModelClass, query: QueryDescription): readonly OrderTerm[] {
  return [...query.order, { attribute: model.primaryKey, direction: "asc" }];
}

/** `query`'s order, or the primary key ascending without one: what `first` and `last` use. */
export function finderOrder(model: ModelClass, query: QueryDescription): readonly OrderTerm[] {
  const { order } = query;
  return order.length > 0 ? order : [{ attribute: model.primaryKey, direction: "asc" }];
}

/** The first record `query` gives in `order`, keeping its offset, or null: what `first`, `last` and `take` load. */
export async function oneInOrder<M extends Model>(
  runner: QueryRunner<M>,
  query: QueryDescription,
  order: readonly OrderTerm[],
): Promise<M | null> {
  const [record] = await runner.load({ ...query, order, limit: atMostOne(query.limit) });
  return record ?? null;
}

/**
 * The only record `query` gives, asking for two rows (keeping its order and offset): a join's
 * repeated rows count as more than one, as Rails counts them.
 */
export async function soleIn<M extends Model>(
  runner: QueryRunner<M>,
  query: QueryDescription,
): Promise<M> {
  return onlyOne(query.model, await runner.load({ ...query, limit: atMost(2, query.limit) }));
}

/** The one record in `records`; `RecordNotFound` with none, `SoleRecordExceeded` with more. */
export function onlyOne<M extends Model>(model: ModelClass, records: readonly M[]): M {
  const [record] = records;
  if (record === undefined) throw notFound(model);
  if (records.length > 1) throw new SoleRecordExceeded(`Wanted only one ${model.name}`);
  return record;
}

/** `record`, or the `RecordNotFound` a finder that must find one throws: `firstOrThrow`'s. */
export function found<M extends Model>(model: ModelClass, record: M | null): M {
  if (record === null) throw notFound(model);
  return record;
}

/** What a finder that must find a record throws when it finds none. */
function notFound(model: ModelClass): RecordNotFound {
  return new RecordNotFound(`${model.name} not found`);
}
