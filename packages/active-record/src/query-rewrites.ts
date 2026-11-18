// Rewriting a query (#350): `rewhere` and `unscope`, dropping parts of a query: its conditions, or those on some attributes, its order, page, and the rest.
import { IncompatibleRelation } from "./errors.ts";
import {
  Either,
  JoinedConditions,
  JoinedOrder,
  LinkedTo,
  Negated,
  type Condition,
  type JoinKind,
  type QueryDescription,
} from "./query.ts";
import { attributeOf } from "./metadata.ts";
import type { AttributesOf, Model } from "./model.ts";

/** A part of a query `unscope` drops: `unscope("order")`. */
export type QueryPart =
  | "where"
  | "order"
  | "limit"
  | "offset"
  | "select"
  | "distinct"
  | "includes"
  | "joins"
  | "leftJoins"
  | "createWith";

/** Each part `unscope` drops, as the query without it. */
const WITHOUT: Readonly<Record<QueryPart, (query: QueryDescription) => QueryDescription>> = {
  where: (query) => ({ ...query, conditions: [] }),
  order: (query) => ({ ...without(query, "reordered"), order: [] }),
  limit: (query) => without(query, "limit"),
  offset: (query) => without(query, "offset"),
  select: (query) => without(query, "select"),
  distinct: (query) => without(query, "distinct"),
  includes: (query) => without(query, "includes"),
  joins: (query) => withoutJoins(query, "inner"),
  leftJoins: (query) => withoutJoins(query, "left"),
  createWith: (query) => without(query, "createWith"),
};

/** A copy of `query` without the optional `key`. */
function without(query: QueryDescription, key: keyof QueryDescription): QueryDescription {
  const copy = { ...query };
  delete copy[key];
  return copy;
}

/** `query` without `part`. */
export function withoutPart(query: QueryDescription, part: QueryPart): QueryDescription {
  if (!Object.hasOwn(WITHOUT, part)) {
    throw new TypeError(
      `unscope() takes ${Object.keys(WITHOUT)
        .map((name) => `"${name}"`)
        .join(", ")}, or { where: attributes }; got ${String(part)}`,
    );
  }
  return WITHOUT[part](query);
}

/** `query` without the associations it joins this way, and their joins in turn. */
function withoutJoins(query: QueryDescription, kind: JoinKind): QueryDescription {
  const joins = (query.joins ?? []).filter((join) => join.kind !== kind);
  const used = joinedPaths(query).find((path) => !joins.some((join) => join.association === path));
  if (used !== undefined) {
    throw new IncompatibleRelation(
      `unscope() can't drop the join of "${used}": conditions or an order merged onto it use it`,
    );
  }
  return joins.length === 0 ? without(query, "joins") : { ...query, joins };
}

/** The associations joined at the top that a merged Relation's conditions or order are on. */
function joinedPaths({ conditions, order }: QueryDescription): string[] {
  const paths = [
    ...conditions.flatMap(joinedPathsIn),
    ...order.flatMap((term) => (term instanceof JoinedOrder ? [term.path] : [])),
  ];
  return paths.map((path) => path.split(".")[0]!);
}

/** The join paths a condition's merged conditions are on, at any depth. */
function joinedPathsIn(condition: Condition): string[] {
  if (condition instanceof JoinedConditions) return [condition.path];
  if (condition instanceof Negated) return joinedPathsIn(condition.condition);
  if (condition instanceof Either)
    return [...condition.left, ...condition.right].flatMap(joinedPathsIn);
  return [];
}

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

/** One attribute's name, or several: what `unscope({ where })` takes. */
export type AttributeNames<M extends Model> =
  | (keyof AttributesOf<M> & string)
  | readonly (keyof AttributesOf<M> & string)[];

/** `query` without one part `unscope` was given: a part's name, or `{ where: attributes }`. */
export function unscoped(
  query: QueryDescription,
  part: QueryPart | { where: string | readonly string[] },
): QueryDescription {
  if (typeof part === "string") return withoutPart(query, part);
  if (typeof part !== "object" || part === null || !("where" in part)) {
    throw new TypeError(
      `unscope() takes a part's name, or { where: attributes }; got ${String(part)}`,
    );
  }
  const attributes = typeof part.where === "string" ? [part.where] : part.where;
  for (const name of attributes) attributeOf(query.model, name);
  return withoutConditionsOn(query, attributes);
}
