// What a Relation's methods take, checked when a query is written, not when it runs.
import type { Conflict } from "./bulk-insert-sql.ts";
import type { Assignment } from "./compiler.ts";
import { Comparison } from "./comparisons.ts";
import { attributeName, withAttributeNames } from "./attribute-aliases.ts";
import { attributeFor } from "./attribute.ts";
import { refuseBareDates } from "./fragment-guard.ts";
import { type AttributeType, columnOf } from "./metadata.ts";
import type { AttributesOf, ModelClass } from "./model.ts";
import { IncompatibleRelation } from "./errors.ts";
import {
  JoinedOrder,
  type NullsPlacement,
  type OrderDirection,
  type OrderTerm,
  type QueryDescription,
} from "./query.ts";
import { ColumnValue, isAttributeReference, SafeSql } from "./sql.ts";

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

/**
 * Values that can be compared: numbers, strings, dates, bytes (byte by byte), and a custom
 * type's values, compared as their stored values are (#20). Booleans and json (`unknown`) can't
 * be, nor a custom type stored as either, which `where` refuses when it's called.
 */
type ComparisonOf<V> = [V] extends [boolean] ? never : unknown extends V ? never : Comparison<V>;

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

/**
 * `upsert`/`upsertAll` options: the attributes of the unique index to match on, and the
 * attributes a clashing row has updated (every one written, by default).
 */
export interface UpsertOptions<M> {
  uniqueBy?: (keyof AttributesOf<M> & string) | readonly (keyof AttributesOf<M> & string)[];
  updateOnly?: (keyof AttributesOf<M> & string) | readonly (keyof AttributesOf<M> & string)[];
  onDuplicate?: OnDuplicate<M>;
  returning?: Returning<M>;
}

/**
 * What a clashing row's attributes become (#531): each an `sql` fragment, where `column()`
 * names the clashing row's value and `incoming()` the new row's, or a value.
 */
export type OnDuplicate<M> = {
  [K in keyof AttributesOf<M>]?: SafeSql | AttributesOf<M>[K];
};

/** The bulk writes that update a row that clashes. */
export type UpsertMethod = "upsert" | "upsertAll";

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

/** Refuses an `sql` fragment where only attribute values make sense: it names no attributes (#350). */
export function requireAttributeConditions(conditions: unknown, method: string): void {
  if (conditions instanceof SafeSql) {
    throw new TypeError(
      `${method}() takes an object of attribute values; an sql\`…\` fragment names no attributes to replace`,
    );
  }
  requireObjectOrFragment(conditions, method);
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
export function checkFragment(model: ModelClass, fragment: SafeSql): void {
  for (const value of fragment.values) {
    if (!isAttributeReference(value)) continue;
    columnOf(model, value.attribute);
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
    const { type } = columnOf(model, name);
    rejectUndefined(value, name, method);
    if (value instanceof Comparison) requireOrdered(type, name, method);
  }
}

/** Attribute changes for `updateAll`, checked like conditions: declared, and not undefined. */
export function checkChanges(model: ModelClass, changes: object): Assignment[] | SafeSql {
  checkConditions(model, changes, "updateAll");
  if (changes instanceof SafeSql) return changes;
  // An alias's value is its attribute's, so each column is set once (#509).
  const assignments = Object.entries(withAttributeNames(model, changes as Record<string, unknown>));
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
    columnOf(model, attribute);
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

/**
 * An upsert's conflict: update, matching on `uniqueBy` (the primary key by default), a row
 * that already has the new row's `ownedBy` values (#451), only `updateOnly`'s attributes when
 * it's given (#36).
 */
export function updateOn<M>(
  model: ModelClass,
  options: UpsertOptions<M>,
  { ownedBy, method }: { ownedBy: readonly string[]; method: UpsertMethod },
): Conflict {
  const uniqueBy = [options.uniqueBy ?? model.primaryKey].flat() as string[];
  for (const name of uniqueBy) columnOf(model, name);
  if (options.onDuplicate !== undefined) {
    if (options.updateOnly !== undefined) {
      throw new TypeError(`${method}() takes updateOnly or onDuplicate, not both`);
    }
    const set = onDuplicateSets(model, options.onDuplicate, { uniqueBy, ownedBy, method });
    return { kind: "update", uniqueBy, ownedBy, set };
  }
  if (options.updateOnly === undefined) return { kind: "update", uniqueBy, ownedBy };
  const given = [options.updateOnly].flat();
  const update = updatedNames(model, given, { uniqueBy, method, option: "updateOnly", kept: [] });
  return { kind: "update", uniqueBy, ownedBy, update };
}

/**
 * `onDuplicate`'s attributes, by their own names, checked as `updateOnly`'s are, and what each
 * is set to: its fragment, checked, or its value cast and normalized as an assigned value is
 * (#531). It can't name an owner's key, `ownedBy`, so it can't give a row to another owner.
 */
function onDuplicateSets(
  model: ModelClass,
  given: unknown,
  {
    uniqueBy,
    ownedBy,
    method,
  }: { uniqueBy: readonly string[]; ownedBy: readonly string[]; method: UpsertMethod },
): [string, unknown][] {
  if (
    typeof given !== "object" ||
    given === null ||
    Array.isArray(given) ||
    given instanceof SafeSql
  ) {
    throw new TypeError(
      `${method}() onDuplicate takes an object of attributes, each an sql\`…\` fragment or a value`,
    );
  }
  const entries = Object.entries(given);
  const names = updatedNames(
    model,
    entries.map(([name]) => name),
    { uniqueBy, method, option: "onDuplicate", kept: ownedBy },
  );
  return entries.map(([, value], index) => {
    const name = names[index]!;
    if (!(value instanceof SafeSql)) return [name, attributeFor(model, name).assigned(value)];
    checkFragment(model, value);
    return [name, value];
  });
}

/**
 * The attributes `updateOnly` or `onDuplicate` names, by their own names, checked: each one an
 * attribute an update can write, not one of the owner's `kept` keys, and at least one (#36, #531).
 */
function updatedNames(
  model: ModelClass,
  given: readonly string[],
  {
    uniqueBy,
    method,
    option,
    kept,
  }: {
    uniqueBy: readonly string[];
    method: UpsertMethod;
    option: string;
    kept: readonly string[];
  },
): string[] {
  if (given.length === 0) {
    const skip = method === "upsert" ? "insert(row" : "insertAll(rows";
    throw new TypeError(
      `${method}() ${option} names no attributes; to leave a clashing row as it is, use ${skip}, { onDuplicate: "skip" })`,
    );
  }
  const matched = new Set(uniqueBy.map((name) => attributeName(model, name)));
  return given.map((name) => {
    const own = attributeName(model, name);
    const refusal = kept.includes(own)
      ? "which its owner's records keep"
      : updateRefusal(model, own, matched);
    if (refusal !== undefined)
      throw new TypeError(`${method}() ${option} can't name ${name}, ${refusal}`);
    return own;
  });
}

/** Why an upsert can't update `name` on a clash, if it can't. */
function updateRefusal(
  model: ModelClass,
  name: string,
  matched: ReadonlySet<string>,
): string | undefined {
  if (columnOf(model, name).readonly === true) return "which is read-only";
  if (matched.has(name)) return "which uniqueBy matches on";
  if (name === "createdAt") return "which an update keeps";
  return undefined;
}

/** The query a write statement targets; rows from `distinct()` have no identity to write to. */
export function writableQuery(query: QueryDescription, method: string): QueryDescription {
  if (query.distinct)
    throw new IncompatibleRelation(`${method}() can't be combined with distinct()`);
  return query;
}

/** Throws `IncompatibleRelation` when `or` or `merge` joins Relations of two Models. */
export function requireSameModel(model: ModelClass, other: ModelClass, method: string): void {
  if (other !== model) {
    throw new IncompatibleRelation(
      `${method}() needs relations of the same Model, not ${model.name} and ${other.name}`,
    );
  }
}

/** Checks the whole query each Relation is made from, however it was written. */
export function checkQuery(query: QueryDescription): void {
  checkPreloadable(query);
  refuseDistinctJoinedOrder(query);
  refuseDistinctListOrder(query);
}

/**
 * Throws `IncompatibleRelation` for a distinct query ordered by `inOrderOf` (#350): Postgres
 * can't sort distinct rows by an expression it doesn't select, so no database does.
 */
function refuseDistinctListOrder(query: QueryDescription): void {
  const isListOrdered = query.order.some(
    (term) =>
      !(term instanceof SafeSql) && !(term instanceof JoinedOrder) && term.inOrderOf !== undefined,
  );
  if (query.distinct && isListOrdered) {
    throw new IncompatibleRelation(
      "distinct() can't be combined with inOrderOf(): Postgres can't sort distinct rows by a value's place in a list",
    );
  }
}

/** Preloading needs keys a distinct select leaves out; adding them would undo the distinct. */
function checkPreloadable(query: QueryDescription): void {
  if (query.includes !== undefined && query.select !== undefined && query.distinct) {
    throw new IncompatibleRelation(
      "includes() can't be combined with select(...).distinct(): preloading needs keys the distinct select leaves out",
    );
  }
}

/**
 * Throws `IncompatibleRelation` for a distinct query ordered by a joined Model's attribute:
 * Postgres can't sort distinct rows by a column it doesn't select, so no database does.
 */
function refuseDistinctJoinedOrder(query: QueryDescription): void {
  if (query.distinct && query.order.some((term) => term instanceof JoinedOrder)) {
    throw new IncompatibleRelation(
      `distinct() can't be combined with an order on a joined Model: ${query.model.name}'s distinct rows don't hold its columns to sort by`,
    );
  }
}

/** What a scope that doesn't return a Relation of its Model throws. */
export function scopeResultError(model: ModelClass, name: string): TypeError {
  return new TypeError(
    `${model.name} scope "${name}" must return a Relation of ${model.name}, e.g. (q) => q.where(...)`,
  );
}
