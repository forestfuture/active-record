// `inOrderOf` (#350): ordering by an attribute's place in a list of values, as Rails' `in_order_of`.
import { attributeOf } from "./metadata.ts";
import type { ModelClass } from "./model.ts";
import type { AttributeOrder } from "./query.ts";

/** What `inOrderOf` takes after its list: whether to keep only the records with a listed value. */
export interface InOrderOfOptions {
  /** Keep only the records whose value is in the list (the default), as Rails does; `false` keeps every one, those not in it last. */
  filter?: boolean;
}

/**
 * The order term sorting by `attribute`'s place in `values`: earliest first, and a value not in
 * them last, as Rails' `in_order_of(…, filter: false)` places it.
 */
export function listOrder(model: ModelClass, attribute: string, values: unknown): AttributeOrder {
  const { type } = attributeOf(model, attribute);
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
  return { attribute, direction: "asc", nulls: "last", inOrderOf: [...values] };
}
