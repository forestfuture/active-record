// QueryDescription, the immutable value a Relation describes, and combining (`or`, `merge`).
import { Comparison } from "./comparisons.ts";
import { IncompatibleRelation } from "./errors.ts";
import type { Model, ModelClass } from "./model.ts";
import { ColumnReference, ColumnValue, SafeSql } from "./sql.ts";

export type OrderDirection = "asc" | "desc";

export type NullsPlacement = "first" | "last";

/** Sorting by an attribute; `nulls` places NULLs (SQLite puts them first when ascending). */
interface AttributeOrder {
  attribute: string;
  direction: OrderDirection;
  nulls?: NullsPlacement;
}

/** One ORDER BY term: an attribute, or an `sql` fragment for an expression. */
export type OrderTerm = AttributeOrder | SafeSql;

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
}

export type Condition = Record<string, unknown> | SafeSql | Negated | Either | LinkedTo;

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

/** All of `model`'s rows, in no particular order. */
export function allOf(model: ModelClass<Model>): QueryDescription {
  return { model, conditions: [], order: [] };
}

/** Everything but the conditions: what `or` requires to match and `merge` may replace. */
const SHAPE_CLAUSES = ["select", "order", "limit", "offset", "distinct"] as const;

type ShapeClause = (typeof SHAPE_CLAUSES)[number];

/** Whether two descriptions agree on one shape clause, by that clause's own rule. */
function sameClause(clause: ShapeClause, a: QueryDescription, b: QueryDescription): boolean {
  switch (clause) {
    case "select":
      return sameList(a.select, b.select, (x, y) => x === y);
    case "order":
      return sameList(a.order, b.order, sameOrderTerm);
    default:
      return Object.is(a[clause], b[clause]);
  }
}

function sameOrderTerm(x: OrderTerm, y: OrderTerm): boolean {
  if (x instanceof SafeSql || y instanceof SafeSql) {
    return x instanceof SafeSql && y instanceof SafeSql && sameFragment(x, y);
  }
  return x.attribute === y.attribute && x.direction === y.direction && x.nulls === y.nulls;
}

/** Fragments with the same text and the same values. */
function sameFragment(x: SafeSql, y: SafeSql): boolean {
  return (
    sameList(x.strings, y.strings, (a, b) => a === b) && sameList(x.values, y.values, sameValue)
  );
}

/** Columns by attribute, typed values by attribute and value, dates by time, the rest by identity. */
function sameValue(a: unknown, b: unknown): boolean {
  if (a instanceof ColumnReference && b instanceof ColumnReference) {
    return a.attribute === b.attribute;
  }
  if (a instanceof ColumnValue && b instanceof ColumnValue) {
    return a.attribute === b.attribute && sameInput(a.assigned, b.assigned);
  }
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  return Object.is(a, b);
}

/** A typed value's input: an object (a json value) by its JSON text, else as `sameValue`. */
function sameInput(a: unknown, b: unknown): boolean {
  const objects = typeof a === "object" && a !== null && typeof b === "object" && b !== null;
  if (!objects || a instanceof Date || b instanceof Date || Object.is(a, b)) {
    return sameValue(a, b);
  }
  try {
    return JSON.stringify(a) === JSON.stringify(b);
  } catch {
    return false; // a BigInt or a cycle: not the same as anything but itself
  }
}

function sameList<T>(
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
  for (const clause of SHAPE_CLAUSES) {
    if (!sameClause(clause, a, b)) {
      throw new IncompatibleRelation(
        `or() needs relations that differ only in their conditions, but their ${clause} differs`,
      );
    }
  }
  if (!sameTree(a.includes ?? {}, b.includes ?? {})) {
    throw new IncompatibleRelation(
      "or() needs relations that differ only in their conditions, but their includes differ",
    );
  }
  return { ...a, conditions: [new Either(a.conditions, b.conditions)] };
}

/**
 * `b`'s conditions ANDed onto `a`'s (`merge()`). For select, order, limit, offset and distinct,
 * a clause `b` sets explicitly replaces `a`'s; one it doesn't set is kept. Includes are unioned.
 */
export function merged(a: QueryDescription, b: QueryDescription): QueryDescription {
  const result: QueryDescription = {
    ...a,
    conditions: [...a.conditions, ...b.conditions],
    ...(b.none === true && { none: true }),
    ...(b.includes !== undefined && { includes: mergeTrees(a.includes ?? {}, b.includes) }),
  };
  for (const clause of SHAPE_CLAUSES) {
    if (isSet(b, clause)) Object.assign(result, { [clause]: b[clause] });
  }
  if (b.reordered) result.reordered = true;
  return result;
}

/**
 * The single equality values of the conditions (a value or null), which a record built from a
 * Relation starts with. Arrays, comparisons, `whereNot`, `or` and fragments carry nothing over.
 */
export function inheritedAttributes(conditions: readonly Condition[]): Record<string, unknown> {
  const inherited: Record<string, unknown> = {};
  for (const condition of conditions) {
    if (
      condition instanceof SafeSql ||
      condition instanceof Negated ||
      condition instanceof Either
    ) {
      continue;
    }
    for (const [name, value] of Object.entries(condition)) {
      if (!Array.isArray(value) && !(value instanceof Comparison)) inherited[name] = value;
    }
  }
  return inherited;
}

/** The union of two include trees. */
export function mergeTrees(a: IncludeTree, b: IncludeTree): IncludeTree {
  const merged: Record<string, IncludeTree> = { ...a };
  for (const [name, nested] of Object.entries(b)) {
    merged[name] = mergeTrees(merged[name] ?? {}, nested);
  }
  return merged;
}

/** Whether two include trees name the same associations at every level. */
function sameTree(a: IncludeTree, b: IncludeTree): boolean {
  const names = Object.keys(a);
  if (names.length !== Object.keys(b).length) return false;
  return names.every((name) => b[name] !== undefined && sameTree(a[name]!, b[name]!));
}
