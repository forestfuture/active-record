// Turns a QueryDescription or a write into SQL text and bound values, with what differs per database from a dialect.
import { type Attribute, attributeFor, noMatch } from "./attribute.ts";
import { rowGroups } from "./bulk-rows.ts";
import { isIgnoringColumns } from "./table-names.ts";
import type { Model, ModelClass } from "./model.ts";
import { Comparison } from "./comparisons.ts";
import { compileComparison, compileEquality } from "./condition-values.ts";
import {
  Either,
  LinkedTo,
  isJoining,
  JoinedOrder,
  Negated,
  JoinedConditions,
  type Condition,
  type OrderTerm,
  type QueryDescription,
} from "./query.ts";
import { ColumnReference, ColumnValue, SafeSql } from "./sql.ts";
import { writeUntypedValue } from "./conversion.ts";
import { type Dialect, valueMark } from "./dialect.ts";
import { boundValue } from "./filtering.ts";
import {
  columnIn,
  ownSource,
  quoteIdentifier,
  sourceAt,
  unqualifiedSource,
  tablesOf,
  type Source,
  type Tables,
} from "./query-tables.ts";

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

/**
 * What a SELECT lists: SQL the library wrote, never the caller, or the columns of `attributes`
 * (every column when it's undefined), qualified when the query joins.
 */
export type Projection = string | { readonly attributes: readonly string[] | undefined };

/** Where a condition is compiled: the query's tables, the one it's about, and its bound values. */
interface Context {
  readonly dialect: Dialect;
  readonly tables: Tables;
  readonly source: Source;
  readonly params: unknown[];
}

/**
 * `projection` is the SELECT list; by default, the columns of the query's `select`. With
 * `grouping`, the rows are grouped by the list's first columns, one for each of its terms.
 */
export function compileSelect(
  dialect: Dialect,
  query: QueryDescription,
  projection: Projection = { attributes: query.select },
  grouping?: Grouping,
): CompiledSql {
  const tables = tablesOf(query);
  const context: Context = { dialect, tables, source: tables.own, params: [] };
  const list =
    typeof projection === "string" ? projection : columnsIn(tables.own, projection.attributes);
  let sql = `SELECT ${query.distinct ? "DISTINCT " : ""}${list}`;
  sql += ` FROM ${tables.own.name}${compileJoins(context)}`;
  sql += compileWhere(context, query.conditions);
  if (grouping !== undefined) sql += compileGroupBy(context, grouping);
  sql += compileOrder(context, query.order);
  sql += compilePagination(dialect, query, context.params);
  return { sql, params: context.params, model: query.model };
}

/** Each joined table's `INNER JOIN` or `LEFT OUTER JOIN`, on its link and its scope's conditions. */
function compileJoins(context: Context): string {
  return context.tables.joined
    .map(({ join, parent, source, alias }) => {
      const kind = join.kind === "inner" ? "INNER JOIN" : "LEFT OUTER JOIN";
      const table =
        quoteIdentifier(join.model.table) + (alias === undefined ? "" : ` ${source.name}`);
      const linked = context.dialect.linkedKey(
        columnIn(source, join.targetAttribute),
        attributeFor(join.model, join.targetAttribute),
        attributeFor(parent.model, join.ownerAttribute),
      );
      let on = `${columnIn(parent, join.ownerAttribute)} = ${linked}`;
      if (join.on.length > 0) on += ` AND ${compileAll({ ...context, source }, join.on)}`;
      return ` ${kind} ${table} ON ${on}`;
    })
    .join("");
}

function compileWhere(context: Context, conditions: readonly Condition[]): string {
  return conditions.length === 0 ? "" : ` WHERE ${compileAll(context, conditions)}`;
}

/** Conditions ANDed together as one predicate; no conditions matches everything. */
function compileAll(context: Context, conditions: readonly Condition[]): string {
  if (conditions.length === 0) return "(1 = 1)";
  return `(${conditions.map((condition) => compileCondition(context, condition)).join(" AND ")})`;
}

/** One condition as a single parenthesized predicate. */
function compileCondition(context: Context, condition: Condition): string {
  const { source, params } = context;
  if (condition instanceof Either) {
    return `(${compileAll(context, condition.left)} OR ${compileAll(context, condition.right)})`;
  }
  if (condition instanceof Negated) {
    return `(NOT ${compileCondition(context, condition.condition)})`;
  }
  if (condition instanceof SafeSql) return `(${compileFragment(condition, source, params)})`;
  if (condition instanceof LinkedTo) return `(${compileLinkedTo(context, condition)})`;
  if (condition instanceof JoinedConditions) {
    return compileAll(
      { ...context, source: sourceAt(context.tables, condition.path) },
      condition.conditions,
    );
  }
  const parts = Object.entries(condition).map(([name, value]) => {
    const attribute = attributeFor(source.model, name);
    const column = columnIn(source, name);
    return value instanceof Comparison
      ? compileComparison({ column, attribute }, value, params)
      : compileEquality(context.dialect, { column, attribute }, value, params);
  });
  return `(${parts.join(" AND ")})`;
}

/**
 * `attr IN (SELECT key FROM … WHERE …)`: the keys of the records `owners` finds. With a limit
 * or offset, its order picks those records; without, it's left out, as it can't change them.
 * The dialect selects the key so it compares with `attr` as a condition would, across key types.
 */
function compileLinkedTo(
  { dialect, source, params }: Context,
  { attribute, owners, ownerKey }: LinkedTo,
): string {
  const linked = attributeFor(source.model, attribute);
  const keyAttribute = attributeFor(owners.model, ownerKey);
  const column = columnIn(source, attribute);
  const keyColumn = columnIn(ownSource(owners), ownerKey);
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
  const attributes = assignments.map(([name]) => attributeFor(model, name));
  const params: unknown[] = [];
  const values = compileValues(
    attributes,
    assignments.map(([, value]) => value),
    params,
  );
  return { sql: `INSERT INTO ${table} ${values}${returned}`, params, model };
}

/** `("col", …) VALUES (?, …)`: one row of `attributes`' values, each bound as itself. */
function compileValues(
  attributes: readonly Attribute[],
  values: readonly unknown[],
  params: unknown[],
): string {
  const columns = attributes.map(({ column }) => quoteIdentifier(column)).join(", ");
  for (const [index, attribute] of attributes.entries()) attribute.bind(params, values[index]);
  return `(${columns}) VALUES (${attributes.map(() => valueMark).join(", ")})`;
}

/** ` RETURNING` the whole row, or the columns of `attributes`, or nothing when there are none. */
function compileReturning(
  model: ModelClass<Model>,
  attributes: readonly string[] | undefined,
): string {
  if (attributes?.length === 0) return "";
  return ` RETURNING ${columnsIn(unqualifiedSource(model), attributes)}`;
}

/**
 * What an insert does when a row conflicts with a unique index: skip it, or update it; through
 * an owner's hasMany, only a row that already has the `ownedBy` values the new row has (#451).
 */
export type Conflict =
  | { kind: "skip" }
  | {
      kind: "update";
      uniqueBy: readonly string[];
      update?: readonly string[];
      ownedBy: readonly string[];
    };

/** A bulk insert: its attributes, each row's values, what a conflict does, and what it returns. */
export interface BulkInsert {
  names: readonly string[];
  rows: readonly (readonly unknown[])[];
  conflict?: Conflict | undefined;
  returning: readonly string[];
}

/**
 * `INSERT` of several rows, all with the attributes `names`, bound as one JSON parameter, which
 * the dialect reads them from: one statement and one bound value, whatever the number of rows,
 * within D1's limit of 100 bound parameters per statement. Rows whose JSON would pass the
 * dialect's `maxValueBytes` take several statements, and a row whose JSON alone would pass it
 * binds each of its values apart, as `compileInsert` does (#392).
 */
export function compileInsertRows(
  dialect: Dialect,
  model: ModelClass<Model>,
  { names, rows, conflict, returning }: BulkInsert,
): CompiledSql[] {
  const attributes = names.map((name) => attributeFor(model, name));
  const columns = attributes.map(({ column }) => quoteIdentifier(column)).join(", ");
  const table = quoteIdentifier(model.table);
  const { select, from } = dialect.bulkRows(table, attributes);
  const end = compileConflict(model, names, conflict) + compileReturning(model, returning);
  return rowGroups(model, names, rows, dialect.maxValueBytes).map((group) => {
    if (group.kind === "json") {
      // `WHERE true` keeps SQLite from reading ON CONFLICT as part of the SELECT.
      const sql = `INSERT INTO ${table} (${columns}) SELECT ${select} FROM ${from} WHERE true${end}`;
      return { sql, params: [group.value], model };
    }
    const params: unknown[] = [];
    const values = compileValues(attributes, group.row, params);
    return { sql: `INSERT INTO ${table} ${values}${end}`, params, model };
  });
}

/**
 * `ON CONFLICT DO NOTHING`, or `ON CONFLICT (…) DO UPDATE SET` the `update` attributes (every
 * inserted one by default) except the `uniqueBy` ones and `createdAt`,
 * `WHERE` the clashing row already has the new row's `ownedBy` values (#451).
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
  return ` ON CONFLICT (${target}) DO UPDATE SET ${sets}${compileOwnedBy(model, conflict.ownedBy, column)}`;
}

/** ` WHERE "t"."a" = excluded."a" AND …`: the clashing row already has the new row's values. */
function compileOwnedBy(
  model: ModelClass<Model>,
  ownedBy: readonly string[],
  column: (name: string) => string,
): string {
  if (ownedBy.length === 0) return "";
  const table = quoteIdentifier(model.table);
  const same = ownedBy.map((name) => `${table}.${column(name)} = excluded.${column(name)}`);
  return ` WHERE ${same.join(" AND ")}`;
}

/**
 * `UPDATE … SET … WHERE <primary key> = ?` for the given attribute values, or an `sql`
 * fragment's sets, `RETURNING` the `returning` attributes. `storedKey` is the key as stored in
 * D1 (the row's key before any change to it), so it's bound as-is.
 */
export function compileUpdate(
  model: ModelClass<Model>,
  changes: readonly Assignment[] | SafeSql,
  storedKey: unknown,
  returning: readonly string[] = [],
): CompiledSql {
  const params: unknown[] = [];
  const sets = compileSets(model, changes, params);
  const primaryKey = attributeFor(model, model.primaryKey);
  attributeFor(model, model.primaryKey).bindCells(params, storedKey);
  const returned = compileReturning(model, returning);
  return {
    sql: `UPDATE ${quoteIdentifier(model.table)} SET ${sets} WHERE ${quoteIdentifier(primaryKey.column)} = ${valueMark}${returned}`,
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
  if (changes instanceof SafeSql) return compileFragment(changes, unqualifiedSource(model), params);
  return changes
    .map(([name, value]) => {
      const attribute = attributeFor(model, name);
      attribute.bind(params, value);
      return `${quoteIdentifier(attribute.column)} = ${valueMark}`;
    })
    .join(", ");
}

/**
 * The WHERE clause for writing to the rows `query` describes: its conditions;
 * with a limit or offset, or joins (#24), `<primary key> IN (SELECT <primary key> … ORDER …
 * LIMIT … OFFSET)`; `1 = 0` for `none()`. Order without a limit, select and includes don't
 * matter to a write.
 */
function compileTarget(dialect: Dialect, query: QueryDescription, params: unknown[]): string {
  if (query.none) return " WHERE 1 = 0";
  const key = columnIn(unqualifiedSource(query.model), query.model.primaryKey);
  if (!hasLimitOrOffset(query) && !isJoining(query)) {
    const tables = tablesOf(query);
    return compileWhere({ dialect, tables, source: tables.own, params }, query.conditions);
  }
  const inner = compileSelect(
    dialect,
    { ...query, distinct: false },
    columnIn(ownSource(query), query.model.primaryKey),
  );
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

/**
 * A whole row: `*`, or the declared columns when the Model ignores some of its table's (not its
 * virtual attributes, which have none, #356).
 */
function allColumns(source: Source): string {
  if (isIgnoringColumns(source.model)) {
    const columns = [...source.model.attributeDefinitions].filter(([, { virtual }]) => !virtual);
    return columnsIn(
      source,
      columns.map(([name]) => name),
    );
  }
  return source.qualified ? `${source.name}.*` : "*";
}

/** The columns of `source`'s `attributes`, or its whole row. */
function columnsIn(source: Source, attributes: readonly string[] | undefined): string {
  if (attributes === undefined) return allColumns(source);
  return attributes.map((name) => columnIn(source, name)).join(", ");
}

/**
 * Counts over the whole query as a subquery, so `count()` always equals the number of
 * rows `toArray()` would return (including limit, offset, select and distinct).
 * `count(attr)` counts non-null values, or distinct non-null values after `distinct()`. With a
 * limit or offset too, the limit and offset pick from the distinct values.
 */
export function compileCount(
  dialect: Dialect,
  query: QueryDescription,
  attribute?: string,
): CompiledSql {
  const toCount = queryToCount(query);
  if (attribute === undefined) return countOver(compileSelect(dialect, toCount), "*");
  const column = columnIn(unqualifiedSource(query.model), attribute);
  if (query.distinct && hasLimitOrOffset(query)) {
    // The limit and offset pick from the distinct values, the ones
    // `pluck(attr)` returns, and the non-null ones are counted (#250). A `DISTINCT` on the
    // outer `COUNT` would count what's left of every row.
    return countOver(compileSelect(dialect, toCount, { attributes: [attribute] }), column);
  }
  const inner = compileSelect(dialect, { ...toCount, select: undefined, distinct: false });
  return countOver(inner, query.distinct ? `DISTINCT ${column}` : column);
}

/** `SELECT COUNT(<counted>)` over `inner` as a subquery. */
function countOver(inner: CompiledSql, counted: string): CompiledSql {
  return { ...inner, sql: `SELECT COUNT(${counted}) AS count FROM (${inner.sql}) AS counted` };
}

/** The SQL aggregate each calculation compiles to (#344). */
const AGGREGATES = { sum: "SUM", average: "AVG", minimum: "MIN", maximum: "MAX" } as const;

/** A calculation over an attribute's values: `sum`, `average`, `minimum` or `maximum` (#344). */
export type Calculation = keyof typeof AGGREGATES;

/**
 * A calculation over the rows `toArray()` would return, as `count()` counts them: the values of
 * the attribute or the fragment's expression are selected in a subquery, with the Relation's
 * conditions, its `distinct`, and its order, limit and offset when a limit or offset picks the
 * rows. A sum of no rows is 0.
 */
export function compileCalculation(
  dialect: Dialect,
  query: QueryDescription,
  calculation: Calculation,
  operand: string | SafeSql,
): CompiledSql {
  // The fragment's values come first, as its SQL does.
  const params: unknown[] = [];
  const expression = compileOperand(ownSource(query), operand, params);
  const toCalculate = { ...queryToCount(query), select: undefined };
  const alias = quoteIdentifier(valuesAlias(query.model));
  const inner = compileSelect(dialect, toCalculate, `${expression} AS ${alias}`);
  const aggregate = `${AGGREGATES[calculation]}(${alias})`;
  const value = calculation === "sum" ? `COALESCE(${aggregate}, 0)` : aggregate;
  return {
    ...inner,
    sql: `SELECT ${value} AS value FROM (${inner.sql}) AS calculated`,
    params: [...params, ...inner.params],
  };
}

/** What a Relation is grouped by (#345): its terms, in order, and the groups `having` keeps. */
export interface Grouping {
  /** Attributes, and `sql` fragments of the row. */
  readonly terms: readonly (string | SafeSql)[];
  readonly having: readonly SafeSql[];
}

/**
 * `GROUP BY` the list's first columns, by position, one for each term, then `HAVING` each of
 * `having`'s fragments, with their values appended to `params`.
 */
function compileGroupBy({ source, params }: Context, { terms, having }: Grouping): string {
  let sql = ` GROUP BY ${terms.map((_, index) => index + 1).join(", ")}`;
  if (having.length === 0) return sql;
  const kept = having.map((fragment) => `(${compileFragment(fragment, source, params)})`);
  sql += ` HAVING ${kept.join(" AND ")}`;
  return sql;
}

/** An attribute's column, or a fragment's SQL with its values appended to `params`. */
function compileOperand(source: Source, operand: string | SafeSql, params: unknown[]): string {
  return operand instanceof SafeSql
    ? compileFragment(operand, source, params)
    : columnIn(source, operand);
}

/** A grouped calculation: `count`, or a calculation of an attribute or a fragment. */
export interface GroupedCalculation {
  readonly operation: "count" | Calculation;
  /** What's calculated; a count without one counts rows. */
  readonly operand?: string | SafeSql;
}

/** Whether `operation` finds an extreme, which `DISTINCT` can't change. */
function isExtreme(operation: GroupedCalculation["operation"]): boolean {
  return operation === "minimum" || operation === "maximum";
}

/**
 * A calculation of each group (#345): the groups' keys, each term's value as its `keyAlias`, then
 * the result as `valuesAlias`. The Relation's order and limit pick and order the groups. After
 * `distinct()`, a count, sum or average takes each group's distinct values. A sum of only NULLs
 * is 0.
 */
export function compileGrouped(
  dialect: Dialect,
  query: QueryDescription,
  grouping: Grouping,
  { operation, operand }: GroupedCalculation,
): CompiledSql {
  // The SELECT list's values come first, as its SQL does.
  const params: unknown[] = [];
  const own = ownSource(query);
  const keys = grouping.terms.map(
    (term, index) =>
      `${compileOperand(own, term, params)} AS ${quoteIdentifier(keyAlias(query.model, index))}`,
  );
  const aggregated = operand === undefined ? "*" : compileOperand(own, operand, params);
  // After distinct(), each distinct value counts once; extremes don't change.
  const distinct = query.distinct && operand !== undefined && !isExtreme(operation);
  const aggregate = `${operation === "count" ? "COUNT" : AGGREGATES[operation]}(${distinct ? "DISTINCT " : ""}${aggregated})`;
  const value = operation === "sum" ? `COALESCE(${aggregate}, 0)` : aggregate;
  const projection = [...keys, `${value} AS ${quoteIdentifier(valuesAlias(query.model))}`];
  const ungrouped = { ...query, select: undefined, distinct: false };
  const inner = compileSelect(dialect, ungrouped, projection.join(", "), grouping);
  return { ...inner, params: [...params, ...inner.params] };
}

/**
 * A name for a calculation's values that none of the Model's columns has, whatever its letter
 * case: an `ORDER BY` name matches an output column before a table's, so the order's own would
 * be lost. A column the Model doesn't declare, ordered by in a fragment's raw text, isn't seen.
 */
export function valuesAlias(model: ModelClass<Model>): string {
  return unusedName(model, "value");
}

/** A name for the key of a grouped Relation's term at `index`, unused as `valuesAlias` is. */
export function keyAlias(model: ModelClass<Model>, index: number): string {
  return unusedName(model, `key_${index}`);
}

/** `name`, with underscores before it until none of the Model's columns has it. */
function unusedName(model: ModelClass<Model>, name: string): string {
  const columns = new Set(
    [...model.attributeDefinitions.values()].map(({ column }) => column.toLowerCase()),
  );
  let alias = name;
  while (columns.has(alias)) alias = `_${alias}`;
  return alias;
}

/** Whether a limit or offset picks which rows `query` describes. */
function hasLimitOrOffset(query: QueryDescription): boolean {
  return query.limit !== undefined || query.offset !== undefined;
}

/**
 * The query a count reads: without the order unless a limit or offset picks the rows by it,
 * so SQLite doesn't sort every match only to count it (#215).
 */
function queryToCount(query: QueryDescription): QueryDescription {
  if (hasLimitOrOffset(query)) return query;
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

function compileOrder(context: Context, order: readonly OrderTerm[]): string {
  if (order.length === 0) return "";
  return ` ORDER BY ${order.map((term) => compileOrderTerm(context, term)).join(", ")}`;
}

/** One ORDER BY term, a joined Model's on its join's table. */
function compileOrderTerm(context: Context, term: OrderTerm): string {
  const { source, params, tables } = context;
  if (term instanceof JoinedOrder) {
    return compileOrderTerm({ ...context, source: sourceAt(tables, term.path) }, term.term);
  }
  if (term instanceof SafeSql) return compileFragment(term, source, params);
  const { attribute, direction, nulls } = term;
  const column = columnIn(source, attribute);
  const sorted =
    term.inOrderOf === undefined ? column : placeInList(context, attribute, term.inOrderOf);
  return `${sorted} ${direction.toUpperCase()}${nulls ? ` NULLS ${nulls.toUpperCase()}` : ""}`;
}

/**
 * `column`'s place among `values` (#350), bound as one list: each converted as a condition's
 * value is, and those that can't be left out, as a list condition leaves them out.
 */
function placeInList(
  { dialect, source, params }: Context,
  name: string,
  values: readonly unknown[],
): string {
  // Qualified, so a column the list's own rows have (json_each's `id`) still names the table's.
  const column = columnIn({ ...source, qualified: true }, name);
  const attribute = attributeFor(source.model, name);
  const cells = values
    .map((value) => (value === null ? null : attribute.conditionCell(value)))
    .filter((cell) => cell !== noMatch);
  const list = dialect.placeInList(column, cells, attribute);
  attribute.bindCells(params, list.value);
  return list.sql;
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
function compileFragment(fragment: SafeSql, source: Source, params: unknown[]): string {
  let text = fragment.strings[0] ?? "";
  fragment.values.forEach((value, index) => {
    if (value instanceof ColumnReference) {
      text += columnIn(source, value.attribute);
    } else if (value instanceof ColumnValue) {
      // Normalized as an assigned value is (#354).
      const attribute = attributeFor(source.model, value.attribute);
      attribute.bindCells(params, attribute.write(attribute.assigned(value.assigned)));
      text += valueMark;
    } else {
      params.push(writeUntypedValue(value));
      text += valueMark;
    }
    text += fragment.strings[index + 1] ?? "";
  });
  return text;
}
