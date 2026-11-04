// The order and limit a finder (`first`, `last`, `take`) applies, and the order a page keeps.
import { IrreversibleOrder } from "./errors.ts";
import type { ModelClass } from "./model.ts";
import type { OrderTerm, QueryDescription } from "./query.ts";
import { SafeSql } from "./sql.ts";

/** The same term sorting the other way; NULLs move to the other end too, as in Rails. */
export function reversed(term: OrderTerm): OrderTerm {
  if (term instanceof SafeSql) {
    throw new IrreversibleOrder(
      "last() can't reverse an order given as an sql fragment; order by attributes, or reverse the fragment yourself and use first()",
    );
  }
  const direction = term.direction === "asc" ? "desc" : "asc";
  const nulls = term.nulls && (term.nulls === "first" ? "last" : "first");
  return { ...term, direction, ...(nulls && { nulls }) };
}

/** One record from the page: `limit(0)` stays empty, and `offset` is kept by the caller. */
export function atMostOne(limit: number | undefined): number {
  return Math.min(limit ?? 1, 1);
}

/**
 * `query`'s order, ended with what makes a row unique, so tied rows keep their pages between
 * requests: the primary key, or after `distinct()`, the selected attributes (the key isn't
 * loaded). Those already in the order aren't added again.
 */
export function stableOrder(model: ModelClass, query: QueryDescription): readonly OrderTerm[] {
  const unique = query.distinct && query.select ? query.select : [model.primaryKey];
  const ordered = new Set(query.order.map((term) => !(term instanceof SafeSql) && term.attribute));
  const ties = unique
    .filter((attribute) => !ordered.has(attribute))
    .map((attribute) => ({ attribute, direction: "asc" as const }));
  return [...query.order, ...ties];
}
