// What a Relation's methods take, checked when a query is written, not when it runs.
import type { Assignment, Conflict } from "./compiler.ts";
import { Comparison } from "./comparisons.ts";
import { attributeFor } from "./attribute.ts";
import { refuseBareDates } from "./fragment-guard.ts";
import { attributeOf, type AttributeType } from "./metadata.ts";
import type { AttributesOf, ModelClass } from "./model.ts";
import type { NullsPlacement, OrderDirection, OrderTerm } from "./query.ts";
import { ColumnValue, namesAttribute, SafeSql } from "./sql.ts";

/**
 * Attribute conditions for `where`/`findBy`: a value, an array meaning "any of these", or a
 * comparison (`gte(18)`, `between(a, b)`). `null` (alone or in an array) matches NULL, and is
 * only allowed for nullable attributes.
 */
export type Conditions<M> = {
  [K in keyof AttributesOf<M>]?:
    | AttributesOf<M>[K]
    | readonly AttributesOf<M>[K][]
    | ComparisonOf<NonNullable<AttributesOf<M>[K]>>;
};

/** Numbers, strings and dates are ordered, so they can be compared; booleans and json can't. */
type ComparisonOf<V> = [V] extends [number | string | Date] ? Comparison<V> : never;

/**
 * The attributes a bulk insert or upsert returns of each row it writes: the primary key by
 * default, or `false` for none, which sends no `RETURNING`.
 */
export type Returning<M> = readonly (keyof AttributesOf<M> & string)[] | false;

/**
 * `insert`/`insertAll` options: `onDuplicate: "skip"` skips rows that clash with a unique index,
 * and `returning` names the attributes to return of each row written.
 */
export interface InsertOptions<M = unknown> {
  onDuplicate?: "skip";
  returning?: Returning<M>;
}

/** `upsert`/`upsertAll` options: the attributes of the unique index to match on. */
export interface UpsertOptions<M> {
  uniqueBy?: (keyof AttributesOf<M> & string) | readonly (keyof AttributesOf<M> & string)[];
  returning?: Returning<M>;
}

/** `{ attribute: "asc" | "desc" }`; key order sets precedence. */
export type OrderSpec<M> = {
  [K in keyof AttributesOf<M>]?:
    | OrderDirection
    | { direction: OrderDirection; nulls?: NullsPlacement };
};

function requireObjectOrFragment(conditions: unknown, method: string): void {
  if (typeof conditions !== "object" || conditions === null || Array.isArray(conditions)) {
    throw new TypeError(
      `${method}() takes an object of attribute values or an sql\`…\` fragment; plain strings are not accepted`,
    );
  }
}

/** An undefined value (alone or in an array) would bind NULL into `= ?` and match nothing. */
function rejectUndefined(value: unknown, name: string, method: string): void {
  if (value === undefined || (Array.isArray(value) && value.includes(undefined))) {
    throw new TypeError(
      `${method}() got undefined for "${name}"; use null to match NULL, or leave the key out`,
    );
  }
}

/** Only ordered values compare meaningfully; booleans (0/1) and json text don't. */
function requireOrdered(type: AttributeType, name: string, method: string): void {
  if (type === "boolean" || type === "json") {
    throw new TypeError(
      `${method}() can't compare "${name}", a ${type} attribute; match values instead`,
    );
  }
}

/** `"desc"` or `{ direction: "desc", nulls: "last" }` for `attribute`, checked. */
function attributeOrder(attribute: string, value: unknown, method: string): OrderTerm {
  const [direction, nulls] =
    typeof value === "object" && value !== null
      ? [Reflect.get(value, "direction"), Reflect.get(value, "nulls")]
      : [value, undefined];
  if (direction !== "asc" && direction !== "desc") {
    throw new TypeError(`${method}() direction for "${attribute}" must be "asc" or "desc"`);
  }
  if (nulls !== undefined && nulls !== "first" && nulls !== "last") {
    throw new TypeError(`${method}() nulls for "${attribute}" must be "first" or "last"`);
  }
  return nulls === undefined ? { attribute, direction } : { attribute, direction, nulls };
}

/**
 * A fragment's `column()` references must name declared attributes, and so must its typed
 * values, which must also be values those attributes can hold, so a mistake surfaces where the
 * fragment is written, not when the query runs (#142). A bare date beside an integer-stored
 * column is refused too (#149).
 */
function checkFragment(model: ModelClass, fragment: SafeSql): void {
  for (const value of fragment.values) {
    if (!namesAttribute(value)) continue;
    attributeOf(model, value.attribute);
    if (value instanceof ColumnValue) {
      attributeFor(model, value.attribute).cast(value.assigned);
    }
  }
  refuseBareDates(model, fragment);
}

/** `{}` adds no condition at all (common when an object is built from optional filters). */
export function isEmptyConditions(conditions: object): boolean {
  return !(conditions instanceof SafeSql) && Object.keys(conditions).length === 0;
}

/**
 * Validates conditions when they're written, not when they run: rejects plain strings,
 * unknown attributes, and undefined values (which would otherwise silently match nothing).
 */
export function checkConditions(model: ModelClass, conditions: object, method: string): void {
  requireObjectOrFragment(conditions, method);
  if (conditions instanceof SafeSql) {
    checkFragment(model, conditions);
    return;
  }
  for (const [name, value] of Object.entries(conditions)) {
    const { type } = attributeOf(model, name);
    rejectUndefined(value, name, method);
    if (value instanceof Comparison) requireOrdered(type, name, method);
  }
}

/** Attribute changes for `updateAll`, checked like conditions: declared, and not undefined. */
export function checkChanges(model: ModelClass, changes: object): Assignment[] | SafeSql {
  checkConditions(model, changes, "updateAll");
  if (changes instanceof SafeSql) return changes;
  const assignments = Object.entries(changes);
  if (assignments.length === 0) {
    throw new TypeError("updateAll() needs at least one attribute to change");
  }
  return assignments;
}

/** Checks an order spec when it's written, not when it runs. */
export function orderTerms(model: ModelClass, spec: object, method: string): OrderTerm[] {
  requireObjectOrFragment(spec, method);
  if (spec instanceof SafeSql) {
    checkFragment(model, spec);
    return [spec];
  }
  return Object.entries(spec).map(([attribute, value]) => {
    attributeOf(model, attribute);
    return attributeOrder(attribute, value, method);
  });
}

/** The conflict for `onDuplicate: "skip"`, checked; none without it. */
export function skipOn(
  { onDuplicate }: InsertOptions<unknown>,
  method: string,
): Conflict | undefined {
  if (onDuplicate === undefined) return undefined;
  if (onDuplicate !== "skip") throw new TypeError(`${method}() onDuplicate must be "skip"`);
  return { kind: "skip" };
}

/** The attributes `returning` names, checked: the primary key when it's not given, none for `false`. */
export function returnedNames(
  model: ModelClass,
  returning: readonly string[] | false | undefined,
): string[] {
  if (returning !== undefined && returning !== false && !Array.isArray(returning)) {
    throw new TypeError("returning must be a list of attributes, or false");
  }
  const names =
    returning === undefined ? [model.primaryKey] : returning === false ? [] : [...returning];
  return names;
}

/** An upsert's conflict: update, matching on `uniqueBy` (the primary key by default). */
export function updateOn<M>(model: ModelClass, options: UpsertOptions<M>): Conflict {
  const uniqueBy = [options.uniqueBy ?? model.primaryKey].flat() as string[];
  for (const name of uniqueBy) attributeOf(model, name);
  return { kind: "update", uniqueBy };
}
