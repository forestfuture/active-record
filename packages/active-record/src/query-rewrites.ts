// Rewriting a query (#350): `rewhere`, dropping the conditions on some attributes before adding others.
import { Either, LinkedTo, Negated, type Condition, type QueryDescription } from "./query.ts";

/**
 * `query` without its conditions on `attributes`, as Rails' `unscope(where:)`: an object condition
 * loses those keys, and a `whereNot` or `or` condition goes when it names only them. A fragment,
 * a condition merged onto a join, and one naming other attributes too are kept.
 */
export function withoutConditionsOn(
  query: QueryDescription,
  attributes: readonly string[],
): QueryDescription {
  const dropped = new Set(attributes);
  const conditions = query.conditions.flatMap((condition) => kept(condition, dropped));
  return { ...query, conditions };
}

/** What's left of `condition` once those on `dropped` attributes go: itself, part of it, or nothing. */
function kept(condition: Condition, dropped: ReadonlySet<string>): Condition[] {
  if (isPlainConditions(condition)) {
    const left = Object.entries(condition).filter(([name]) => !dropped.has(name));
    return left.length === 0 ? [] : [Object.fromEntries(left)];
  }
  const named = attributesNamed(condition);
  const isOnlyDropped =
    named !== undefined && named.size > 0 && [...named].every((name) => dropped.has(name));
  return isOnlyDropped ? [] : [condition];
}

/** Whether a condition is an object of attribute values, `where({ role: "admin" })`. */
function isPlainConditions(condition: Condition): condition is Record<string, unknown> {
  return (
    Object.getPrototypeOf(condition) === Object.prototype ||
    Object.getPrototypeOf(condition) === null
  );
}

/**
 * The attributes a condition names, or undefined when that can't be known: a fragment's SQL, or
 * a joined Model's conditions.
 */
function attributesNamed(condition: Condition): Set<string> | undefined {
  if (isPlainConditions(condition)) return new Set(Object.keys(condition));
  if (condition instanceof Negated) return attributesNamed(condition.condition);
  if (condition instanceof LinkedTo) return new Set([condition.attribute]);
  if (condition instanceof Either) return namedByAll([...condition.left, ...condition.right]);
  return undefined;
}

/** The attributes several conditions name together, or undefined when any's can't be known. */
function namedByAll(conditions: readonly Condition[]): Set<string> | undefined {
  const names = new Set<string>();
  for (const condition of conditions) {
    const named = attributesNamed(condition);
    if (named === undefined) return undefined;
    for (const name of named) names.add(name);
  }
  return names;
}
