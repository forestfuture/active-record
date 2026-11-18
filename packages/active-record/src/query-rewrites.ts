// Rewriting a query (#350): `rewhere`, `unscope` and `only`, dropping parts of a query (its conditions, or those on some attributes, its order, page, and the rest), and the keys `excluding` leaves out.
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
  type UnscopedPart,
} from "./query.ts";
import { attributeOf } from "./metadata.ts";
import { isPlainObject } from "./permit.ts";
import { checkConditions, requireAttributeConditions } from "./relation-checks.ts";
import { Model, primaryKeyOf, type AttributesOf, type ModelClass } from "./model.ts";

/** A part of a query `unscope` drops by name: `unscope("order")`. */
export type QueryPart = Exclude<UnscopedPart, object>;

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
function withoutPart(query: QueryDescription, part: QueryPart): QueryDescription {
  requirePart(part);
  return keepingOwnerLink(WITHOUT[part](query));
}

/** Refuses a part `unscope` and `only` don't know: `"group"`, or a misspelling. */
function requirePart(part: unknown): asserts part is QueryPart {
  if (typeof part !== "string" || !Object.hasOwn(WITHOUT, part)) {
    const parts = Object.keys(WITHOUT).map((name) => `"${name}"`);
    throw new TypeError(`A query's parts are ${parts.join(", ")}; got ${String(part)}`);
  }
}

/** `query` with only the parts named, as Rails' `only`: every other part is dropped. */
export function withOnly(query: QueryDescription, parts: readonly QueryPart[]): QueryDescription {
  for (const part of parts) requirePart(part);
  const dropped = (Object.keys(WITHOUT) as QueryPart[]).filter((part) => !parts.includes(part));
  return dropped.reduce(withoutPart, query);
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
function withoutConditionsOn(
  query: QueryDescription,
  attributes: readonly string[],
): QueryDescription {
  const dropped = new Set(attributes);
  const link = new Set(query.ownerLink);
  const conditions = query.conditions.flatMap((condition) =>
    link.has(condition) ? [condition] : remainderOf(condition, dropped),
  );
  return keepingOwnerLink({ ...query, conditions });
}

/** `query` with `condition` added as part of its link to an association's owner (#350). */
export function withOwnerLink(query: QueryDescription, condition: Condition): QueryDescription {
  const ownerLink = [...(query.ownerLink ?? []), condition];
  return { ...query, conditions: [...query.conditions, condition], ownerLink };
}

/**
 * `query` with each condition of its owner link that a rewrite dropped added back (#350): within
 * an `or`, dropping the `or` drops the link with it, so the link is ANDed on again.
 */
function keepingOwnerLink(query: QueryDescription): QueryDescription {
  const lost = (query.ownerLink ?? []).filter(
    (link) => !query.conditions.some((condition) => hasLink(condition, link)),
  );
  return lost.length === 0 ? query : { ...query, conditions: [...query.conditions, ...lost] };
}

/** Whether `condition` is `link`, or has it within an `or` or a `whereNot`. */
function hasLink(condition: Condition, link: Condition): boolean {
  if (condition === link) return true;
  if (condition instanceof Either) {
    return [...condition.left, ...condition.right].some((each) => hasLink(each, link));
  }
  return condition instanceof Negated && hasLink(condition.condition, link);
}

/** Whether a condition is an object of attribute values, `where({ role: "admin" })`. */
function isAttributeValues(condition: Condition): condition is Record<string, unknown> {
  return isPlainObject(condition);
}

/** What's left of `condition` once those on `dropped` attributes go: itself, part of it, or nothing. */
function remainderOf(condition: Condition, dropped: ReadonlySet<string>): Condition[] {
  if (isAttributeValues(condition)) {
    const left = Object.entries(condition).filter(([name]) => !dropped.has(name));
    return left.length === 0 ? [] : [Object.fromEntries(left)];
  }
  const named = attributesNamed(condition);
  const isOnlyDropped =
    named !== undefined && named.size > 0 && [...named].every((name) => dropped.has(name));
  return isOnlyDropped ? [] : [condition];
}

/**
 * The attributes a condition names, or undefined when that can't be known: a fragment's SQL, or
 * a joined Model's conditions.
 */
function attributesNamed(condition: Condition): Set<string> | undefined {
  if (isAttributeValues(condition)) return new Set(Object.keys(condition));
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

/** What `unscope` is given for each part: its name, or `{ where }` with attributes. */
type UnscopeGiven = QueryPart | { where: string | readonly string[] };

/** `query` without one part `unscope` was given: a part's name, or `{ where: attributes }`, which it keeps for `merge`. */
export function unscoped(query: QueryDescription, given: UnscopeGiven): QueryDescription {
  const part = unscopedPart(query, given);
  return { ...withoutUnscoped(query, part), unscoped: [...(query.unscoped ?? []), part] };
}

/** What `unscope` was given, checked, with `{ where }`'s attributes as a list. */
function unscopedPart(query: QueryDescription, given: UnscopeGiven): UnscopedPart {
  if (typeof given === "string") {
    requirePart(given);
    return given;
  }
  if (typeof given !== "object" || given === null || !("where" in given)) {
    throw new TypeError(
      `unscope() takes a part's name, or { where: attributes }; got ${String(given)}`,
    );
  }
  const attributes = typeof given.where === "string" ? [given.where] : [...given.where];
  for (const name of attributes) attributeOf(query.model, name);
  return { where: attributes };
}

/** `query` without one part `unscope` dropped. */
function withoutUnscoped(query: QueryDescription, part: UnscopedPart): QueryDescription {
  return typeof part === "string"
    ? withoutPart(query, part)
    : withoutConditionsOn(query, part.where);
}

/**
 * `into` with the parts `other` was unscoped of dropped, before `other` merges into it, as Rails'
 * merge does; only for a Relation of the same Model, whose parts they name.
 */
export function withUnscopesOf(into: QueryDescription, other: QueryDescription): QueryDescription {
  if (other.unscoped === undefined || other.model !== into.model) return into;
  return other.unscoped.reduce(withoutUnscoped, into);
}

/**
 * `query` with `conditions` in place of those on their attributes (`rewhere`), as Rails' `rewhere`:
 * conditions on other attributes, and fragments, are kept.
 */
export function withConditionsReplaced(
  query: QueryDescription,
  conditions: object,
): QueryDescription {
  requireAttributeConditions(conditions, "rewhere");
  checkConditions(query.model, conditions, "rewhere");
  const names = Object.keys(conditions);
  if (names.length === 0) return query;
  const rest = withoutConditionsOn(query, names);
  return { ...rest, conditions: [...rest.conditions, conditions as Record<string, unknown>] };
}

/** `query` without these records (`excluding`), by primary key: `NOT (id IN (…))`. */
export function withoutRecords(
  query: QueryDescription,
  records: readonly unknown[],
): QueryDescription {
  const keys = excludedKeys(query.model, records);
  if (keys.length === 0) return query;
  const left = new Negated({ [query.model.primaryKey]: keys });
  return { ...query, conditions: [...query.conditions, left] };
}

/**
 * The primary keys of the records `excluding` leaves out, each a record of `model` (or a class
 * extending it); a record without a key yet has no row to leave out.
 */
function excludedKeys(model: ModelClass, records: readonly unknown[]): unknown[] {
  return records.flat().flatMap((record) => {
    if (!(record instanceof model)) {
      throw new TypeError(
        `excluding() takes records of ${model.name}; got ${describedValue(record)}`,
      );
    }
    const key = primaryKeyOf(record);
    return key === null || key === undefined ? [] : [key];
  });
}

/** How a refusal names what it was given: a record's class, or its type. */
function describedValue(value: unknown): string {
  if (value instanceof Model) return `a ${value.constructor.name}`;
  return value === null ? "null" : typeof value;
}
