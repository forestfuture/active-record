// Values normalized where a Relation takes them (#354): its conditions, as `where`, `whereNot`, `rewhere` and `inOrderOf` take them, and a bulk write's values.
import { attributeFor, type Attribute } from "./attribute.ts";
import { Comparison, comparisonParts } from "./comparisons.ts";
import type { ModelClass } from "./model.ts";
import { checkConditions, isEmptyConditions } from "./relation-checks.ts";
import { SafeSql } from "./sql.ts";

/** Conditions on values copied from records, as they're stored: never normalized again. */
const storedConditions = new WeakSet<object>();

/**
 * @internal Marks conditions on keys copied from records (an association's link, a lookup by a
 * loaded record's key), so `where` keeps them as they are: normalizing a stored key could find
 * another record's row (#354).
 */
export function asStored<T extends object>(conditions: T): T {
  storedConditions.add(conditions);
  return conditions;
}

/**
 * `where`'s or `whereNot`'s conditions, checked when they're written and normalized, or
 * `undefined` when they add none (`{}`).
 */
export function checkedConditions<T extends object>(
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
  if (storedConditions.has(conditions)) return linkedConditions(model, conditions);
  let changed = false;
  const entries = Object.entries(conditions).map(([name, value]) => {
    const attribute = attributeFor(model, name);
    if (!attribute.hasNormalization) return [name, value];
    changed = true;
    return [name, normalizedValue(attribute, value)];
  });
  return changed ? (Object.fromEntries(entries) as T) : conditions;
}

/**
 * Stored keys as a link compares them (#588): a uuid's in its one form only, so a key in another
 * form matches nothing, as in a preload or a join. Still marked stored.
 */
function linkedConditions<T extends object>(model: ModelClass, conditions: T): T {
  const entries = Object.entries(conditions);
  if (!entries.some(([name]) => attributeFor(model, name).isUuid)) return conditions;
  const linked = entries.map(([name, value]) => {
    const attribute = attributeFor(model, name);
    const keys = Array.isArray(value) ? value.map((each) => attribute.linkedKey(each)) : undefined;
    return [name, keys ?? attribute.linkedKey(value)];
  });
  return asStored(Object.fromEntries(linked) as T);
}

/** One condition's value normalized: a list item by item, a comparison by its values. */
function normalizedValue(attribute: Attribute, value: unknown): unknown {
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

/**
 * A bulk write's values (an inserted row, `createWith`, `updateAll`'s changes), each cast and
 * normalized as assigning it would be.
 */
export function assignedValues(
  model: ModelClass,
  values: Readonly<Record<string, unknown>>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(values).map(([name, value]) => [
      name,
      attributeFor(model, name).assigned(value),
    ]),
  );
}
