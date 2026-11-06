// Turns a QueryDescription or a write into SQL text and bound values, with what differs per database from a dialect.
import { type Attribute, attributeFor, noMatch, storedRows } from "./attribute.ts";
import { ignoresColumns } from "./table-names.ts";
import type { Model, ModelClass } from "./model.ts";
import { Comparison, comparisonParts, type Operator } from "./comparisons.ts";
import { Either, LinkedTo, Negated, type Condition, type QueryDescription } from "./query.ts";
import { ColumnReference, ColumnValue, SafeSql } from "./sql.ts";
import { writeUntypedValue } from "./conversion.ts";
import { type Dialect, valueMark } from "./dialect.ts";
import { boundValue } from "./filtering.ts";

/** One SQL statement ready to send, with the Model whose table it reads or writes. */
export interface CompiledSql {
  sql: string;
  params: unknown[];
  model: ModelClass<Model>;
}

/** What `toSql()` shows: a query's SQL, with its values bound apart from it (ADR-0006). */
export interface QuerySql {
  sql: string;
  params: unknown[];
}

/** `compiled` as `toSql()` shows it: the values D1 binds, and not the Model it is for. */
export function querySql({ sql, params }: CompiledSql): QuerySql {
  return { sql, params: params.map(boundValue) };
}

/** Quotes an identifier; embedded double quotes are doubled. */
function quoteIdentifier(name: string): string {
  return `"${name.replaceAll('"', '""')}"`;
}

/** `projection` is the SELECT list; the library builds it, never the caller. */
export function compileSelect(
  dialect: Dialect,
  query: QueryDescription,
  projection?: string,
): CompiledSql {
  const params: unknown[] = [];
  const list = projection ?? compileColumns(query.model, query.select);
  let sql = `SELECT ${query.distinct ? "DISTINCT " : ""}${list}`;
  sql += ` FROM ${quoteIdentifier(query.model.table)}`;
  sql += compileWhere(dialect, query, params);
  sql += compileOrder(query, params);
  sql += compilePagination(dialect, query, params);
  return { sql, params, model: query.model };
}

function compileWhere(
  dialect: Dialect,
  { model, conditions }: QueryDescription,
  params: unknown[],
): string {
  return conditions.length === 0 ? "" : ` WHERE ${compileAll(dialect, conditions, model, params)}`;
}

/** Conditions ANDed together as one predicate; no conditions matches everything. */
function compileAll(
  dialect: Dialect,
  conditions: readonly Condition[],
  model: ModelClass<Model>,
  params: unknown[],
): string {
  if (conditions.length === 0) return "(1 = 1)";
  return `(${conditions.map((condition) => compileCondition(dialect, condition, model, params)).join(" AND ")})`;
}

/** One condition as a single parenthesized predicate. */
function compileCondition(
  dialect: Dialect,
  condition: Condition,
  model: ModelClass<Model>,
  params: unknown[],
): string {
  if (condition instanceof Either) {
    const left = compileAll(dialect, condition.left, model, params);
    const right = compileAll(dialect, condition.right, model, params);
    return `(${left} OR ${right})`;
  }
  if (condition instanceof Negated) {
    return `(NOT ${compileCondition(dialect, condition.condition, model, params)})`;
  }
  if (condition instanceof SafeSql) return `(${compileFragment(condition, model, params)})`;
  if (condition instanceof LinkedTo) {
    return `(${compileLinkedTo(dialect, condition, model, params)})`;
  }
  const parts = Object.entries(condition).map(([name, value]) => {
    const attribute = attributeFor(model, name);
    return value instanceof Comparison
      ? compileComparison(attribute, value, params)
      : compileEquality(dialect, attribute, value, params);
  });
  return `(${parts.join(" AND ")})`;
}

/**
 * `attr IN (SELECT key FROM … WHERE …)`: the keys of the records `owners` finds. With a limit
 * or offset, its order picks those records; without, it's left out, as it can't change them.
 * The dialect selects the key so it compares with `attr` as a condition would, across key types.
 */
function compileLinkedTo(
  dialect: Dialect,
  { attribute, owners, ownerKey }: LinkedTo,
  model: ModelClass<Model>,
  params: unknown[],
): string {
  const linked = attributeFor(model, attribute);
  const keyAttribute = attributeFor(owners.model, ownerKey);
  const column = quoteIdentifier(linked.column);
  const keyColumn = quoteIdentifier(keyAttribute.column);
  const selected = dialect.linkedKey(keyColumn, keyAttribute, linked);
  const limited = owners.limit !== undefined || owners.offset !== undefined;
  const order = limited ? owners.order : [];
  // A distinct() with includes selects every column (a distinct select() can't be preloaded),
  // so the primary key already makes each row distinct: left out, it changes nothing.
  const inner = compileSelect(dialect, { ...owners, order, distinct: false }, selected);
  params.push(...inner.params);
  return `${column} IN (${inner.sql})`;
}

/** An attribute and the value to write to it. */
export type Assignment = readonly [attribute: string, value: unknown];

/**
 * `INSERT … RETURNING` the row (`*`, or the declared columns) for the given attribute values, or
 * `DEFAULT VALUES` for none. `returning` names the attributes to return instead; none sends no
 * `RETURNING`.
 */
export function compileInsert(
  model: ModelClass<Model>,
  assignments: readonly Assignment[],
  returning?: readonly string[],
): CompiledSql {
  const table = quoteIdentifier(model.table);
  const returned = compileReturning(model, returning);
  if (assignments.length === 0) {
    return { sql: `INSERT INTO ${table} DEFAULT VALUES${returned}`, params: [], model };
  }
  const columns = assignments
    .map(([name]) => quoteIdentifier(attributeFor(model, name).column))
    .join(", ");
  const placeholders = assignments.map(() => valueMark).join(", ");
  const params: unknown[] = [];
  for (const [name, value] of assignments) attributeFor(model, name).bind(params, value);
  return {
    sql: `INSERT INTO ${table} (${columns}) VALUES (${placeholders})${returned}`,
    params,
    model,
  };
}

/** ` RETURNING` the whole row, or the columns of `attributes`, or nothing when there are none. */
function compileReturning(
  model: ModelClass<Model>,
  attributes: readonly string[] | undefined,
): string {
  if (attributes?.length === 0) return "";
  return ` RETURNING ${compileColumns(model, attributes)}`;
}

/** What an insert does when a row conflicts with a unique index: skip it, or update it. */
export type Conflict =
  | { kind: "skip" }
  | { kind: "update"; uniqueBy: readonly string[]; update?: readonly string[] };

/** A bulk insert: its attributes, each row's values, what a conflict does, and what it returns. */
export interface BulkInsert {
  names: readonly string[];
  rows: readonly (readonly unknown[])[];
  conflict?: Conflict | undefined;
  returning: readonly string[];
}

/**
 * `INSERT` of several rows, all with the attributes `names`, bound as one JSON parameter, which
 * the dialect reads them from. One statement and one bound value, whatever the number of rows,
 * within D1's limit of 100 bound parameters per statement.
 */
export function compileInsertRows(
  dialect: Dialect,
  model: ModelClass<Model>,
  { names, rows, conflict, returning }: BulkInsert,
): CompiledSql {
  const attributes = names.map((name) => attributeFor(model, name));
  const columns = attributes.map(({ column }) => quoteIdentifier(column)).join(", ");
  const table = quoteIdentifier(model.table);
  const { select, from } = dialect.bulkRows(table, attributes);
  const json = storedRows(model, names, rows);
  // `WHERE true` keeps SQLite from reading ON CONFLICT as part of the SELECT.
  const sql =
    `INSERT INTO ${table} (${columns}) ` +
    `SELECT ${select} FROM ${from} WHERE true${compileConflict(model, names, conflict)}` +
    compileReturning(model, returning);
  return { sql, params: [json], model };
}

/**
 * `ON CONFLICT DO NOTHING`, or `ON CONFLICT (…) DO UPDATE SET` the `update` attributes (every
 * inserted one by default) except the `uniqueBy` ones and `createdAt`, as Rails' upsert does.
 */
function compileConflict(
  model: ModelClass<Model>,
  names: readonly string[],
  conflict: Conflict | undefined,
): string {
  if (conflict === undefined) return "";
  if (conflict.kind === "skip") return " ON CONFLICT DO NOTHING";
  const column = (name: string) => quoteIdentifier(attributeFor(model, name).column);
  const target = conflict.uniqueBy.map(column).join(", ");
  const updated = (conflict.update ?? names).filter(
    (name) => !conflict.uniqueBy.includes(name) && name !== "createdAt",
  );
  if (updated.length === 0) return ` ON CONFLICT (${target}) DO NOTHING`;
  const sets = updated.map((name) => `${column(name)} = excluded.${column(name)}`).join(", ");
  return ` ON CONFLICT (${target}) DO UPDATE SET ${sets}`;
}

/**
 * `UPDATE … SET … WHERE <primary key> = ?` for the given attribute values. `storedKey` is
 * the key as stored in D1 (the row's key before any change to it), so it's bound as-is.
 */
export function compileUpdate(
  model: ModelClass<Model>,
  assignments: readonly Assignment[],
  storedKey: unknown,
): CompiledSql {
  const params: unknown[] = [];
  const sets = compileSets(model, assignments, params);
  const primaryKey = attributeFor(model, model.primaryKey);
  attributeFor(model, model.primaryKey).bindCells(params, storedKey);
  return {
    sql: `UPDATE ${quoteIdentifier(model.table)} SET ${sets} WHERE ${quoteIdentifier(primaryKey.column)} = ${valueMark}`,
    params,
    model,
  };
}

/** `"col" = ?, …` for attribute values, or an `sql` fragment's own text. */
function compileSets(
  model: ModelClass<Model>,
  changes: readonly Assignment[] | SafeSql,
  params: unknown[],
): string {
  if (changes instanceof SafeSql) return compileFragment(changes, model, params);
  return changes
    .map(([name, value]) => {
      const attribute = attributeFor(model, name);
      attribute.bind(params, value);
      return `${quoteIdentifier(attribute.column)} = ${valueMark}`;
    })
    .join(", ");
}

/**
 * The WHERE clause for writing to the rows `query` describes, as Rails does it: its conditions;
 * with a limit or offset, `<primary key> IN (SELECT <primary key> … ORDER … LIMIT … OFFSET)`;
 * `1 = 0` for `none()`. Order without a limit, select and includes don't matter to a write.
 */
function compileTarget(dialect: Dialect, query: QueryDescription, params: unknown[]): string {
  if (query.none) return " WHERE 1 = 0";
  if (query.limit === undefined && query.offset === undefined) {
    return compileWhere(dialect, query, params);
  }
  const key = quoteIdentifier(attributeFor(query.model, query.model.primaryKey).column);
  const inner = compileSelect(dialect, { ...query, distinct: false }, key);
  params.push(...inner.params);
  return ` WHERE ${key} IN (${inner.sql})`;
}

/** `UPDATE … SET … WHERE …` for every row `query` describes. */
export function compileUpdateAll(
  dialect: Dialect,
  query: QueryDescription,
  changes: readonly Assignment[] | SafeSql,
): CompiledSql {
  const params: unknown[] = [];
  const sets = compileSets(query.model, changes, params);
  const target = compileTarget(dialect, query, params);
  const sql = `UPDATE ${quoteIdentifier(query.model.table)} SET ${sets}${target}`;
  return { sql, params, model: query.model };
}

/** `DELETE … WHERE …` for every row `query` describes. */
export function compileDeleteAll(dialect: Dialect, query: QueryDescription): CompiledSql {
  const params: unknown[] = [];
  const target = compileTarget(dialect, query, params);
  const sql = `DELETE FROM ${quoteIdentifier(query.model.table)}${target}`;
  return { sql, params, model: query.model };
}

/** `DELETE … WHERE <primary key> = ?`, with the key as stored in D1. */
export function compileDelete(model: ModelClass<Model>, storedKey: unknown): CompiledSql {
  const { column } = attributeFor(model, model.primaryKey);
  const params: unknown[] = [];
  attributeFor(model, model.primaryKey).bindCells(params, storedKey);
  return {
    sql: `DELETE FROM ${quoteIdentifier(model.table)} WHERE ${quoteIdentifier(column)} = ${valueMark}`,
    params,
    model,
  };
}

/** A whole row: `*`, or the declared columns when the Model ignores some of its table's. */
function allColumns(model: ModelClass<Model>): string {
  return ignoresColumns(model)
    ? compileColumns(model, [...model.attributeDefinitions.keys()])
    : "*";
}

/** The quoted columns for `attributes`, or the whole row. */
export function compileColumns(
  model: ModelClass<Model>,
  attributes: readonly string[] | undefined,
): string {
  if (attributes === undefined) return allColumns(model);
  return attributes.map((name) => quoteIdentifier(attributeFor(model, name).column)).join(", ");
}

/**
 * Counts over the whole query as a subquery, so `count()` always equals the number of
 * rows `toArray()` would return (including limit, offset, select and distinct).
 * `count(attr)` counts non-null values, or distinct non-null values after `distinct()`.
 */
export function compileCount(
  dialect: Dialect,
  query: QueryDescription,
  attribute?: string,
): CompiledSql {
  const toCount = queryToCount(query);
  if (attribute === undefined) {
    const inner = compileSelect(dialect, toCount);
    return { ...inner, sql: `SELECT COUNT(*) AS count FROM (${inner.sql}) AS counted` };
  }
  const inner = compileSelect(dialect, { ...toCount, select: undefined, distinct: false });
  const column = quoteIdentifier(attributeFor(query.model, attribute).column);
  const counted = query.distinct ? `DISTINCT ${column}` : column;
  return { ...inner, sql: `SELECT COUNT(${counted}) AS count FROM (${inner.sql}) AS counted` };
}

/**
 * The query a count reads: without the order unless a limit or offset picks the rows by it,
 * so SQLite doesn't sort every match only to count it (#215).
 */
function queryToCount(query: QueryDescription): QueryDescription {
  if (query.limit !== undefined || query.offset !== undefined) return query;
  return { ...query, order: [] };
}

/**
 * `SELECT 1 …` for whether any row `query` describes exists, within its limit and offset. The
 * order is left out: it can't change whether a row exists, even past an offset (#215).
 * `DISTINCT 1` would make the matches one row, which an offset skips, so a distinct query with
 * an offset keeps its own select list: the rows `toArray()` reads (#222).
 */
export function compileExists(dialect: Dialect, query: QueryDescription): CompiledSql {
  const unordered = { ...query, order: [] };
  if (query.distinct && query.offset !== undefined) return compileSelect(dialect, unordered);
  return compileSelect(dialect, unordered, "1");
}

/** `attr >= ?`, `attr BETWEEN ? AND ?`, …, with the values converted like the attribute's. */
function compileComparison(
  attribute: Attribute,
  comparison: Comparison,
  params: unknown[],
): string {
  const { operator, values } = comparison[comparisonParts];
  const stored = values.map((value) => attribute.conditionCell(value));
  if (stored.includes(noMatch)) return NOTHING;
  attribute.bindCells(params, ...stored);
  return COMPARISON_SQL[operator](quoteIdentifier(attribute.column));
}

/**
 * A condition that matches no row: an empty list, or a value that can't be cast (#81), as in
 * Rails 6.1+, so a value from a URL is never an error or a NULL match.
 */
const NOTHING = "1 = 0";

/** Each comparison's SQL for a quoted column; values are bound in order. */
const COMPARISON_SQL: Record<Operator, (column: string) => string> = {
  ">": (column) => `${column} > ${valueMark}`,
  ">=": (column) => `${column} >= ${valueMark}`,
  "<": (column) => `${column} < ${valueMark}`,
  "<=": (column) => `${column} <= ${valueMark}`,
  between: (column) => `${column} BETWEEN ${valueMark} AND ${valueMark}`,
  betweenExcludingEnd: (column) => `(${column} >= ${valueMark} AND ${column} < ${valueMark})`,
};

/** `attr = value`, with NULL and arrays (IN) handled the way the contract specifies. */
function compileEquality(
  dialect: Dialect,
  attribute: Attribute,
  value: unknown,
  params: unknown[],
): string {
  const column = quoteIdentifier(attribute.column);
  if (value === null) return `${column} IS NULL`;
  if (!Array.isArray(value)) {
    const stored = attribute.conditionCell(value);
    if (stored === noMatch) return NOTHING;
    attribute.bindCells(params, stored);
    return `${column} = ${valueMark}`;
  }
  const present = value
    .filter((item) => item !== null)
    .map((item) => attribute.conditionCell(item))
    .filter((item) => item !== noMatch);
  const parts: string[] = [];
  if (present.length > 0) {
    const list = dialect.inList(column, present);
    attribute.bindCells(params, list.value);
    parts.push(list.sql);
  }
  if (value.includes(null)) parts.push(`${column} IS NULL`);
  return parts.length > 0 ? `(${parts.join(" OR ")})` : NOTHING;
}

function compileOrder({ model, order }: QueryDescription, params: unknown[]): string {
  if (order.length === 0) return "";
  const terms = order.map((term) => {
    if (term instanceof SafeSql) return compileFragment(term, model, params);
    const { attribute, direction, nulls } = term;
    const column = quoteIdentifier(attributeFor(model, attribute).column);
    return `${column} ${direction.toUpperCase()}${nulls ? ` NULLS ${nulls.toUpperCase()}` : ""}`;
  });
  return ` ORDER BY ${terms.join(", ")}`;
}

function compilePagination(
  dialect: Dialect,
  { limit, offset }: QueryDescription,
  params: unknown[],
): string {
  if (limit === undefined && offset === undefined) return "";
  return dialect.pagination(limit, offset, params);
}

/** Appends the fragment's values to `params` and returns its SQL text. */
function compileFragment(fragment: SafeSql, model: ModelClass<Model>, params: unknown[]): string {
  let text = fragment.strings[0] ?? "";
  fragment.values.forEach((value, index) => {
    if (value instanceof ColumnReference) {
      text += quoteIdentifier(attributeFor(model, value.attribute).column);
    } else if (value instanceof ColumnValue) {
      attributeFor(model, value.attribute).bind(params, value.assigned);
      text += valueMark;
    } else {
      params.push(writeUntypedValue(value));
      text += valueMark;
    }
    text += fragment.strings[index + 1] ?? "";
  });
  return text;
}
