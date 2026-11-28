// A bulk insert's SQL: its rows bound as JSON, and what it does when a row clashes with a unique index (skip it, or update it, #36, #451).
import { attributeFor } from "./attribute.ts";
import { rowGroups } from "./bulk-rows.ts";
import { compileFragment, compileReturning, compileValues, type CompiledSql } from "./compiler.ts";
import { type Dialect, valueMark } from "./dialect.ts";
import type { Model, ModelClass } from "./model.ts";
import { quoteIdentifier, type Source } from "./query-tables.ts";
import { incoming, IncomingReference, SafeSql } from "./sql.ts";

/**
 * What an insert does when a row conflicts with a unique index: skip it, or update it; through
 * an owner's hasMany, only a row that already has the `ownedBy` values the new row has (#451).
 */
export type Conflict =
  | { kind: "skip" }
  | {
      kind: "update";
      /** The attributes the conflict matches on, by their own names, never an alias (#532). */
      uniqueBy: readonly string[];
      update?: readonly string[];
      /** What `onDuplicate` sets each attribute it names to (#531). */
      set?: readonly AttributeSet[];
      touch?: string | undefined;
      ownedBy: readonly string[];
    };

/** An attribute an update sets, and to what: a fragment, a value, or its incoming value. */
export interface AttributeSet {
  readonly name: string;
  readonly value: unknown;
}

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
  const endParams: unknown[] = [];
  const end =
    compileConflict(dialect, model, { names, conflict, params: endParams }) +
    compileReturning(model, returning);
  return rowGroups(model, names, rows, dialect.maxValueBytes).map((group) => {
    if (group.kind === "json") {
      // `WHERE true` keeps SQLite from reading ON CONFLICT as part of the SELECT.
      const sql = `INSERT INTO ${table} (${columns}) SELECT ${select} FROM ${from} WHERE true${end}`;
      return { sql, params: [group.value, ...endParams], model };
    }
    const params: unknown[] = [];
    const values = compileValues(attributes, group.row, params);
    return {
      sql: `INSERT INTO ${table} ${values}${end}`,
      params: [...params, ...endParams],
      model,
    };
  });
}

/**
 * `ON CONFLICT DO NOTHING`, or `ON CONFLICT (…) DO UPDATE SET` the `update` attributes (every
 * inserted one by default) except the `uniqueBy` ones and `createdAt`, or what `set` gives
 * (#531), and `touch` when one of them changes (#36), `WHERE` the clashing row already has the
 * new row's `ownedBy` values (#451). The values it binds are appended to `params`.
 */
function compileConflict(
  dialect: Dialect,
  model: ModelClass<Model>,
  {
    names,
    conflict,
    params,
  }: { names: readonly string[]; conflict: Conflict | undefined; params: unknown[] },
): string {
  if (conflict === undefined) return "";
  if (conflict.kind === "skip") return " ON CONFLICT DO NOTHING";
  const column = (name: string) => quoteIdentifier(attributeFor(model, name).column);
  const target = conflict.uniqueBy.map(column).join(", ");
  const sets = conflict.set ?? copiedSets(model, names, conflict);
  if (sets.length === 0) return ` ON CONFLICT (${target}) DO NOTHING`;
  const written = sets.map((set) => `${column(set.name)} = ${setValue(model, set, params)}`);
  if (conflict.touch !== undefined)
    written.push(touchSet(dialect, model, sets, { touch: conflict.touch, params }));
  return ` ON CONFLICT (${target}) DO UPDATE SET ${written.join(", ")}${compileOwnedBy(model, conflict.ownedBy)}`;
}

/** What an update sets by default: each `update` attribute to its incoming value. */
function copiedSets(
  model: ModelClass<Model>,
  names: readonly string[],
  conflict: Extract<Conflict, { kind: "update" }>,
): AttributeSet[] {
  return (conflict.update ?? names)
    .filter((name) => !conflict.uniqueBy.includes(name) && name !== "createdAt")
    .map((name) => ({ name, value: incoming(name) }));
}

/**
 * One value an update sets, as SQL: its incoming value, a fragment (`column()` qualified as the
 * clashing row's, which Postgres needs, and `incoming()` allowed, #531), or a value bound.
 */
function setValue(
  model: ModelClass<Model>,
  { name, value }: AttributeSet,
  params: unknown[],
): string {
  if (value instanceof IncomingReference) return clashingAndNew(model, value.attribute)[1];
  if (value instanceof SafeSql) return `(${compileFragment(value, clashSource(model), params)})`;
  attributeFor(model, name).bind(params, value);
  return valueMark;
}

/** The clashing row, which an upsert's `onDuplicate` reads, with the row it writes (#531). */
function clashSource(model: ModelClass<Model>): Source {
  return { model, name: quoteIdentifier(model.table), qualified: true, allowsIncoming: true };
}

/**
 * `touch` set to the new row's value only when a `sets` attribute's value changes: a clashing
 * row written again as it was keeps its own (#36). Each set value is compared as it's written, so
 * a fragment's values are bound again (#531).
 */
function touchSet(
  dialect: Dialect,
  model: ModelClass<Model>,
  sets: readonly AttributeSet[],
  { touch, params }: { touch: string; params: unknown[] },
): string {
  const same = (set: AttributeSet) => {
    const [left] = clashingAndNew(model, set.name);
    const right = setValue(model, set, params);
    const attribute = attributeFor(model, set.name);
    return dialect.sameValue?.(left, right, attribute) ?? `${left} IS NOT DISTINCT FROM ${right}`;
  };
  const unchanged = sets.map(same).join(" AND ");
  const [kept, given] = clashingAndNew(model, touch);
  const column = quoteIdentifier(attributeFor(model, touch).column);
  return `${column} = CASE WHEN ${unchanged} THEN ${kept} ELSE ${given} END`;
}

/** ` WHERE "t"."a" = excluded."a" AND …`: the clashing row already has the new row's values. */
function compileOwnedBy(model: ModelClass<Model>, ownedBy: readonly string[]): string {
  if (ownedBy.length === 0) return "";
  const same = ownedBy.map((name) => clashingAndNew(model, name).join(" = "));
  return ` WHERE ${same.join(" AND ")}`;
}

/** `name`'s column in the clashing row and in the new one: `"t"."a"` and `excluded."a"`. */
function clashingAndNew(model: ModelClass<Model>, name: string): [string, string] {
  const column = quoteIdentifier(attributeFor(model, name).column);
  return [`${quoteIdentifier(model.table)}.${column}`, `excluded.${column}`];
}
