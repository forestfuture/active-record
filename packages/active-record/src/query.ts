// QueryDescription, the immutable value a Relation describes, and combining (`or`, `merge`).
import { Comparison } from "./comparisons.ts";
import { IncompatibleRelation } from "./errors.ts";
import type { Model, ModelClass } from "./model.ts";
import { ColumnReference, ColumnValue, SafeSql } from "./sql.ts";

export type OrderDirection = "asc" | "desc";

export type NullsPlacement = "first" | "last";

/** Sorting by an attribute; `nulls` places NULLs (SQLite puts them first when ascending). */
export interface AttributeOrder {
  attribute: string;
  direction: OrderDirection;
  nulls?: NullsPlacement;
}

/** One ORDER BY term: an attribute, or an `sql` fragment for an expression, or a joined Model's. */
export type OrderTerm = AttributeOrder | SafeSql | JoinedOrder;

/** A joined Model's order term, from `merge()` (#24): compiled on the table of the join `path` names. */
export class JoinedOrder {
  readonly path: string;
  readonly term: AttributeOrder | SafeSql;

  constructor(path: string, term: AttributeOrder | SafeSql) {
    this.path = path;
    this.term = term;
  }
}

/** Association names to preload, each with the names to preload on its records in turn. */
export interface IncludeTree {
  readonly [association: string]: IncludeTree;
}

/**
 * Everything a Relation describes: which rows of one Model, in what shape. An immutable value;
 * Relations copy it, never mutate it. The compiler turns it into SQL.
 */
export interface QueryDescription {
  model: ModelClass<Model>;
  conditions: readonly Condition[];
  order: readonly OrderTerm[];
  /** From `reorder()`: the order replaces any other when merged, even an empty one. */
  reordered?: boolean;
  limit?: number;
  offset?: number;
  /** Attributes to load; undefined loads every column. */
  select?: readonly string[];
  distinct?: boolean;
  /** From `none()`: matches nothing. */
  none?: boolean;
  /** Associations to preload for every record loaded: `includes(...)`. */
  includes?: IncludeTree;
  /** Associations joined: `joins(...)` and `leftJoins(...)` (#24). */
  joins?: readonly Join[];
  /** From `unscope()` (#350): the parts it dropped, which `merge()` drops from the Relation merged into. */
  unscoped?: readonly UnscopedPart[];
  /** From `createWith()`: attributes a record built or inserted through it gets, not conditions. */
  createWith?: Readonly<Record<string, unknown>>;
}

/** A part of a query `unscope()` drops: one by name, or the conditions on some attributes. */
export type UnscopedPart =
  | "where"
  | "order"
  | "limit"
  | "offset"
  | "select"
  | "distinct"
  | "includes"
  | "joins"
  | "leftJoins"
  | "createWith"
  | { readonly where: readonly string[] };

/** How a join keeps the joining rows: only those with a linked row, or every one. */
export type JoinKind = "inner" | "left";

/**
 * One association joined (#24), worked out when the query is written: the table joined, the
 * attributes linking it to the table it's joined to, and the conditions its association's scope
 * and its Model's default scopes add to the join.
 */
export interface Join {
  readonly association: string;
  readonly kind: JoinKind;
  readonly model: ModelClass<Model>;
  /** The attribute of the table it's joined to that links them. */
  readonly ownerAttribute: string;
  /** Its own attribute that links them. */
  readonly targetAttribute: string;
  /** Its scope's conditions, part of the join itself (`ON`), as Rails puts them. */
  readonly on: readonly Condition[];
  /** The associations of its Model joined to it in turn. */
  readonly joins: readonly Join[];
}

export type Condition =
  | Record<string, unknown>
  | SafeSql
  | Negated
  | Either
  | LinkedTo
  | JoinedConditions;

/**
 * The conditions of a joined Model's Relation, from `merge()` (#24): compiled on the table of the
 * join `path` names, the association names leading to it, `"."`-joined.
 */
export class JoinedConditions {
  readonly path: string;
  readonly conditions: readonly Condition[];

  constructor(path: string, conditions: readonly Condition[]) {
    this.path = path;
    this.conditions = conditions;
  }
}

/**
 * A condition from preloading (#217): `attribute` is the `ownerKey` of one of the records
 * `owners` finds, so a preload finds its owners' keys with a subquery, not with keys bound once
 * they're loaded.
 */
export class LinkedTo {
  readonly attribute: string;
  /** The owners' query. */
  readonly owners: QueryDescription;
  readonly ownerKey: string;

  constructor(attribute: string, owners: QueryDescription, ownerKey: string) {
    this.attribute = attribute;
    this.owners = owners;
    this.ownerKey = ownerKey;
  }
}

/** A condition from `or`: either side's conditions (each ANDed together) may match. */
export class Either {
  readonly left: readonly Condition[];
  readonly right: readonly Condition[];

  constructor(left: readonly Condition[], right: readonly Condition[]) {
    this.left = left;
    this.right = right;
  }
}

/** A condition from `whereNot`: the whole condition is negated, `NOT (…)`. */
export class Negated {
  readonly condition: Condition;

  constructor(condition: Condition) {
    this.condition = condition;
  }
}

/** Whether `query` joins any association (#24). */
export function isJoining(query: QueryDescription): boolean {
  return (query.joins?.length ?? 0) > 0;
}

/** Whether a page (`limit`, `offset`) or `distinct()` picks which of `query`'s rows it finds. */
export function hasPageOrDistinct({ limit, offset, distinct }: QueryDescription): boolean {
  return limit !== undefined || offset !== undefined || distinct === true;
}

/** All of `model`'s rows, in no particular order. */
export function allOf(model: ModelClass<Model>): QueryDescription {
  return { model, conditions: [], order: [] };
}

/** Everything but the conditions: what `or` requires to match and `merge` may replace. */
const SHAPE_CLAUSES = ["select", "order", "limit", "offset", "distinct"] as const;

type ShapeClause = (typeof SHAPE_CLAUSES)[number];

/** Whether two descriptions agree on one shape clause, by that clause's own rule. */
function isSameClause(clause: ShapeClause, a: QueryDescription, b: QueryDescription): boolean {
  switch (clause) {
    case "select":
      return isSameList(a.select, b.select, (x, y) => x === y);
    case "order":
      return isSameList(a.order, b.order, isSameOrderTerm);
    default:
      return Object.is(a[clause], b[clause]);
  }
}

function isSameOrderTerm(x: OrderTerm, y: OrderTerm): boolean {
  if (x instanceof JoinedOrder || y instanceof JoinedOrder) return isSameJoinedOrder(x, y);
  if (x instanceof SafeSql || y instanceof SafeSql) {
    return x instanceof SafeSql && y instanceof SafeSql && isSameFragment(x, y);
  }
  return x.attribute === y.attribute && x.direction === y.direction && x.nulls === y.nulls;
}

/** Joined Models' order terms, on the same join. */
function isSameJoinedOrder(x: OrderTerm, y: OrderTerm): boolean {
  if (!(x instanceof JoinedOrder) || !(y instanceof JoinedOrder)) return false;
  return x.path === y.path && isSameOrderTerm(x.term, y.term);
}

/** Fragments with the same text and the same values. */
function isSameFragment(x: SafeSql, y: SafeSql): boolean {
  return (
    isSameList(x.strings, y.strings, (a, b) => a === b) &&
    isSameList(x.values, y.values, isSameValue)
  );
}

/** Columns by attribute, typed values by attribute and value, dates by time, the rest by identity. */
function isSameValue(a: unknown, b: unknown): boolean {
  if (a instanceof ColumnReference && b instanceof ColumnReference) {
    return a.attribute === b.attribute;
  }
  if (a instanceof ColumnValue && b instanceof ColumnValue) {
    return a.attribute === b.attribute && isSameInput(a.assigned, b.assigned);
  }
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return Object.is(a, b);
}

/** A typed value's input: an object (a json value) by its JSON text, else as `isSameValue`. */
function isSameInput(a: unknown, b: unknown): boolean {
  const objects = typeof a === "object" && a !== null && typeof b === "object" && b !== null;
  if (!objects || a instanceof Date || b instanceof Date || Object.is(a, b)) {
    return isSameValue(a, b);
  }
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false; // a BigInt or a cycle: not the same as anything but itself
  }
}

function isSameList<T>(
  a: readonly T[] | undefined,
  b: readonly T[] | undefined,
  same: (x: T, y: T) => boolean,
): boolean {
  if (a === undefined || b === undefined) return a === b;
  return a.length === b.length && a.every((item, index) => same(item, b[index] as T));
}

/**
 * Whether a clause was set explicitly; an empty order or an unset flag counts as not set,
 * unless the order came from `reorder()`.
 */
function isSet(query: QueryDescription, clause: ShapeClause): boolean {
  if (clause === "order" && query.reordered) return true;
  const value = query[clause];
  return Array.isArray(value) ? value.length > 0 : value !== undefined && value !== false;
}

/**
 * Rows matching `a`'s conditions or `b`'s (`or()`). Both must be identical in everything but
 * their conditions; a `none()` side contributes nothing.
 */
export function either(a: QueryDescription, b: QueryDescription): QueryDescription {
  if (a.none) return b;
  if (b.none) return a;
  const differing = whatDiffers(a, b);
  if (differing !== undefined) {
    throw new IncompatibleRelation(
      `or() needs relations that differ only in their conditions, but their ${differing}`,
    );
  }
  return { ...a, conditions: [new Either(a.conditions, b.conditions)] };
}

/** What `or()` says differs between `a` and `b` besides their conditions, if anything: "limit differs". */
function whatDiffers(a: QueryDescription, b: QueryDescription): string | undefined {
  const clause = SHAPE_CLAUSES.find((each) => !isSameClause(each, a, b));
  if (clause !== undefined) return `${clause} differs`;
  if (!isSameJoins(a.joins ?? [], b.joins ?? [])) return "joins differ";
  if (!isSameTree(a.includes ?? {}, b.includes ?? {})) return "includes differ";
  if (!isSameValues(a.createWith, b.createWith)) return "createWith differs";
  return undefined;
}

/**
 * `b`'s conditions ANDed onto `a`'s (`merge()`). For select, order, limit, offset and distinct,
 * a clause `b` sets explicitly replaces `a`'s; one it doesn't set is kept. Includes and joins
 * are unioned.
 */
export function merged(a: QueryDescription, b: QueryDescription): QueryDescription {
  const result: QueryDescription = {
    ...a,
    conditions: [...a.conditions, ...b.conditions],
    ...(b.none === true && { none: true }),
    ...(b.includes !== undefined && { includes: mergeTrees(a.includes ?? {}, b.includes) }),
    ...(b.joins !== undefined && { joins: mergeJoins(a.joins ?? [], b.joins) }),
    ...(b.createWith !== undefined && { createWith: { ...a.createWith, ...b.createWith } }),
  };
  for (const clause of SHAPE_CLAUSES) {
    if (isSet(b, clause)) Object.assign(result, { [clause]: b[clause] });
  }
  if (b.reordered) result.reordered = true;
  return result;
}

/**
 * The single equality values of the conditions (a value or null), which a record built from a
 * Relation starts with. Arrays, comparisons, `whereNot`, `or`, fragments, the subqueries linking
 * records to others', and a joined Model's conditions carry nothing over.
 */
export function inheritedAttributes(conditions: readonly Condition[]): Record<string, unknown> {
  const inherited: Record<string, unknown> = {};
  for (const condition of conditions) {
    if (
      condition instanceof SafeSql ||
      condition instanceof Negated ||
      condition instanceof Either ||
      condition instanceof LinkedTo ||
      condition instanceof JoinedConditions
    ) {
      continue;
    }
    for (const [name, value] of Object.entries(condition)) {
      if (!Array.isArray(value) && !(value instanceof Comparison)) inherited[name] = value;
    }
  }
  return inherited;
}

/** `b`'s joins added to `a`'s: an association joined on both is joined once, with both's joins. */
export function mergeJoins(a: readonly Join[], b: readonly Join[]): readonly Join[] {
  const merged = [...a];
  for (const join of b) {
    const index = merged.findIndex((each) => each.association === join.association);
    const same = merged[index];
    if (same === undefined) {
      merged.push(join);
    } else {
      // An inner join of the association wins: its rows are those both find.
      const kind = same.kind === "inner" || join.kind === "inner" ? "inner" : "left";
      merged[index] = { ...same, kind, joins: mergeJoins(same.joins, join.joins) };
    }
  }
  return merged;
}

/** Whether two lists of joins join the same associations, the same way, at every level. */
function isSameJoins(a: readonly Join[], b: readonly Join[]): boolean {
  return (
    a.length === b.length &&
    a.every((join) => {
      const same = b.find((each) => each.association === join.association);
      return same !== undefined && same.kind === join.kind && isSameJoins(join.joins, same.joins);
    })
  );
}

/** The union of two include trees. */
export function mergeTrees(a: IncludeTree, b: IncludeTree): IncludeTree {
  const merged: Record<string, IncludeTree> = { ...a };
  for (const [name, nested] of Object.entries(b)) {
    merged[name] = mergeTrees(merged[name] ?? {}, nested);
  }
  return merged;
}

/** Whether two sets of attribute values name the same attributes, with the same values (as typed values' inputs). */
function isSameValues(
  a: Readonly<Record<string, unknown>> = {},
  b: Readonly<Record<string, unknown>> = {},
) {
  const names = Object.keys(a);
  if (names.length !== Object.keys(b).length) return false;
  return names.every((name) => Object.hasOwn(b, name) && isSameInput(a[name], b[name]));
}

/** Whether two include trees name the same associations at every level. */
function isSameTree(a: IncludeTree, b: IncludeTree): boolean {
  const names = Object.keys(a);
  if (names.length !== Object.keys(b).length) return false;
  return names.every((name) => b[name] !== undefined && isSameTree(a[name]!, b[name]!));
}
