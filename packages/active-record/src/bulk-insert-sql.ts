// A bulk insert's SQL: its rows bound as JSON, and what it does when a row clashes with a unique index (skip it, or update it, #36, #451).
import { attributeFor, type Attribute } from "./attribute.ts";
import { rowGroups } from "./bulk-rows.ts";
import { compileReturning, compileValues, type CompiledSql } from "./compiler.ts";
import type { Dialect } from "./dialect.ts";
import type { Model, ModelClass } from "./model.ts";
import { quoteIdentifier } from "./query-tables.ts";

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
      touch?: string | undefined;
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
  const end = compileConflict(dialect, model, names, conflict) + compileReturning(model, returning);
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
 * inserted one by default) except the `uniqueBy` ones and `createdAt`, and `touch` when one of
 * them changes (#36), `WHERE` the clashing row already has the new row's `ownedBy` values (#451).
 */
function compileConflict(
  dialect: Dialect,
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
  const sets = updated.map((name) => `${column(name)} = excluded.${column(name)}`);
  if (conflict.touch !== undefined) sets.push(touchSet(dialect, model, updated, conflict.touch));
  return ` ON CONFLICT (${target}) DO UPDATE SET ${sets.join(", ")}${compileOwnedBy(model, conflict.ownedBy, column)}`;
}

/**
 * `touch` set to the new row's value only when an `updated` attribute's value changes: a clashing
 * row written again as it was keeps its own (#36).
 */
function touchSet(
  dialect: Dialect,
  model: ModelClass<Model>,
  updated: readonly string[],
  touch: string,
): string {
  const table = quoteIdentifier(model.table);
  const same = (attribute: Attribute) => {
    const [left, right] = [
      `${table}.${quoteIdentifier(attribute.column)}`,
      `excluded.${quoteIdentifier(attribute.column)}`,
    ];
    return dialect.sameValue?.(left, right, attribute) ?? `${left} IS NOT DISTINCT FROM ${right}`;
  };
  const unchanged = updated.map((name) => same(attributeFor(model, name))).join(" AND ");
  const column = quoteIdentifier(attributeFor(model, touch).column);
  return `${column} = CASE WHEN ${unchanged} THEN ${table}.${column} ELSE excluded.${column} END`;
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
