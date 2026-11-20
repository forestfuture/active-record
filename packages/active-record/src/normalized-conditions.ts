// A query's conditions normalized (#354): each value of an attribute with a normalization, as `where`, `whereNot`, `rewhere` and `inOrderOf` take it, before the Relation keeps it.
import { attributeFor, type Attribute } from "./attribute.ts";
import { Comparison, comparisonParts } from "./comparisons.ts";
import type { ModelClass } from "./model.ts";
import { checkConditions, isEmptyConditions } from "./relation-checks.ts";
import { SafeSql } from "./sql.ts";

/**
 * `where`'s or `whereNot`'s conditions, checked when they're written and normalized, or
 * `undefined` when they add none (`{}`).
 */
export function writtenConditions<T extends object>(
  model: ModelClass,
  conditions: T,
  method: string,
): T | undefined {
  checkConditions(model, conditions, method);
  return isEmptyConditions(conditions) ? undefined : normalizedConditions(model, conditions);
}

/**
 * `conditions` with each value of a normalized attribute normalized: a list's items, a
 * comparison's values, or the value itself. `null` stays, so it still matches NULL. A fragment
 * is kept as it is: its typed values are normalized as it's compiled.
 */
export function normalizedConditions<T extends object>(model: ModelClass, conditions: T): T {
  if (conditions instanceof SafeSql) return conditions;
  let changed = false;
  const entries = Object.entries(conditions).map(([name, value]) => {
    const attribute = attributeFor(model, name);
    if (!attribute.isNormalized) return [name, value];
    changed = true;
    return [name, normalizedValue(attribute, value)];
  });
  return changed ? (Object.fromEntries(entries) as T) : conditions;
}

/** One condition's value normalized: a list item by item, a comparison by its values. */
export function normalizedValue(attribute: Attribute, value: unknown): unknown {
  if (value === null) return null;
  if (Array.isArray(value)) return value.map((item) => normalizedValue(attribute, item));
  if (value instanceof Comparison) {
    const { operator, values } = value[comparisonParts];
    return new Comparison(
      operator,
      values.map((each) => attribute.normalizedCondition(each)),
    );
  }
  return attribute.normalizedCondition(value);
}
