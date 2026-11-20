// `inOrderOf` (#350): ordering by an attribute's place in a list of values.
import { attributeFor } from "./attribute.ts";
import { normalizedConditions } from "./normalized-values.ts";
import { columnOf } from "./metadata.ts";
import type { ModelClass } from "./model.ts";
import type { AttributeOrder, QueryDescription } from "./query.ts";
import { checkConditions } from "./relation-checks.ts";

/** What `inOrderOf` takes after its list: whether to keep only the records with a listed value. */
export interface InOrderOfOptions {
  /** Keep only the records whose value is in the list (the default); `false` keeps every one, those not in it last. */
  filter?: boolean;
}

/**
 * `query` ordered by `attribute`'s place in `values` after its own order, and, with `filter`,
 * matching only those values.
 */
export function listOrdered(
  query: QueryDescription,
  attribute: string,
  values: unknown,
  filter: boolean,
): QueryDescription {
  const order = [...query.order, listOrder(query.model, attribute, values)];
  if (!filter) return { ...query, order };
  const listed = { [attribute]: values };
  checkConditions(query.model, listed, "inOrderOf");
  const normalized = normalizedConditions(query.model, listed);
  return { ...query, order, conditions: [...query.conditions, normalized] };
}

/**
 * The order term sorting by `attribute`'s place in `values`: earliest first, and a value not in
 * them last, where `filter: false` places it.
 */
function listOrder(model: ModelClass, attribute: string, values: unknown): AttributeOrder {
  const { type } = columnOf(model, attribute);
  if (!Array.isArray(values)) {
    throw new TypeError(`inOrderOf() takes a list of "${attribute}" values`);
  }
  if (values.includes(undefined)) {
    throw new TypeError(
      `inOrderOf() got undefined among the values of "${attribute}"; use null to place NULL`,
    );
  }
  if (type === "json") {
    throw new TypeError(`inOrderOf() can't order by "${attribute}", a json attribute`);
  }
  // Normalized now only to refuse what can't be (#354), and kept as given: the compiler
  // normalizes them, so a grouping that writes the term again doesn't normalize them twice.
  const listed = attributeFor(model, attribute);
  for (const value of values) if (value !== null) listed.normalizedCondition(value);
  return { attribute, direction: "asc", nulls: "last", inOrderOf: [...values] };
}
