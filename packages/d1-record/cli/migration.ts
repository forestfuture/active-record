// A generated migration's SQL, for SQLite as D1 runs it.
import {
  indexName,
  migrationPlan,
  type ColumnArg,
  type MigrationChange,
  type MigrationResult,
} from "@forestfuture/active-record/cli";

type SqlResult = { ok: true; sql: string } | { ok: false; error: string };

// SQLite's keywords (https://sqlite.org/lang_keywords.html): a column or table named one is quoted.
const keywords = new Set(
  (
    "abort action add after all alter always analyze and as asc attach autoincrement before begin between by " +
    "cascade case cast check collate column commit conflict constraint create cross current current_date " +
    "current_time current_timestamp database default deferrable deferred delete desc detach distinct do drop " +
    "each else end escape except exclude exclusive exists explain fail filter first following for foreign " +
    "from full generated glob group groups having if ignore immediate in index indexed initially inner insert " +
    "instead intersect into is isnull join key last left like limit match materialized natural no not " +
    "nothing notnull null nulls of offset on or order others outer over partition plan pragma preceding " +
    "primary query raise range recursive references regexp reindex release rename replace restrict returning " +
    "right rollback row rows savepoint select set table temp temporary then ties to transaction trigger " +
    "unbounded union unique update using vacuum values view virtual when where window with without"
  ).split(" "),
);

/** A name as SQL: quoted only when SQLite reserves it, so migrations stay readable. */
function identifier(name: string): string {
  return keywords.has(name) ? `"${name}"` : name;
}

const sqlTypes: Record<Exclude<ColumnArg["type"], "references">, string> = {
  string: "TEXT",
  integer: "INTEGER",
  real: "REAL",
  boolean: "BOOLEAN",
  datetime: "DATETIME",
  json: "TEXT",
};

/** A default as a SQL literal: `TRUE`, `1.5`, `'it''s'`. */
function literal(value: string | number | boolean): string {
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return typeof value === "number" ? String(value) : `'${value.replaceAll("'", "''")}'`;
}

/** A column's definition, as `CREATE TABLE` and `ADD COLUMN` write it. */
function definition(
  column: ColumnArg,
  keys: ReadonlyMap<string, string>,
  notNull: boolean,
): string {
  const name = identifier(column.name);
  if (column.type === "references") {
    const type = keys.get(column.references!) ?? "TEXT";
    return `${name} ${type}${notNull ? " NOT NULL" : ""} REFERENCES ${identifier(column.references!)} (id)`;
  }
  const parts = [name, sqlTypes[column.type]];
  if (notNull) parts.push("NOT NULL");
  if (column.default !== undefined) parts.push(`DEFAULT ${literal(column.default)}`);
  if (column.type === "json") parts.push(`CHECK (json_valid(${name}))`);
  return parts.join(" ");
}

/** `CREATE [UNIQUE] INDEX` for each indexed column. */
function indexes(table: string, columns: readonly ColumnArg[]): string {
  return columns
    .filter((column) => column.index !== "none")
    .map((column) => {
      const unique = column.index === "unique" ? "UNIQUE " : "";
      const on = `${identifier(table)} (${identifier(column.name)})`;
      return `CREATE ${unique}INDEX ${indexName(table, column.name)} ON ${on};\n`;
    })
    .join("");
}

/** `CREATE TABLE`, with its key, columns, timestamps and indexes. */
function createTable(
  table: string,
  columns: readonly ColumnArg[],
  keys: ReadonlyMap<string, string>,
  options: MigrationChange["options"],
): string {
  const lines = [options.integerId ? "id INTEGER PRIMARY KEY" : "id TEXT PRIMARY KEY NOT NULL"];
  for (const column of columns) lines.push(definition(column, keys, column.notNull));
  if (options.timestamps !== false)
    lines.push("created_at DATETIME NOT NULL", "updated_at DATETIME NOT NULL");
  return `CREATE TABLE ${identifier(table)} (\n  ${lines.join(",\n  ")}\n);\n${indexes(table, columns)}`;
}

/** `ADD COLUMN` for each column; a reference added later can be null, as Rails' `add_reference`. */
function addColumns(
  table: string,
  columns: readonly ColumnArg[],
  keys: ReadonlyMap<string, string>,
): SqlResult {
  const refused = columns.find(
    (column) => column.type !== "references" && column.notNull && column.default === undefined,
  );
  if (refused !== undefined) {
    return {
      ok: false,
      error: `${table}.${refused.name}: SQLite can't add a NOT NULL column without a default; give one (${refused.name}:${refused.type}!=…) or leave out the !`,
    };
  }
  const added = columns
    .map((column) => {
      const notNull = column.type !== "references" && column.notNull;
      return `ALTER TABLE ${identifier(table)} ADD COLUMN ${definition(column, keys, notNull)};\n`;
    })
    .join("");
  return { ok: true, sql: added + indexes(table, columns) };
}

/**
 * `DROP COLUMN` for each column, after dropping the index the generators would have made on it
 * (SQLite can't drop an indexed column). A reference drops like any column: D1 allows it.
 */
function removeColumns(table: string, columns: readonly ColumnArg[]): SqlResult {
  const sql = columns
    .map(
      (column) =>
        `DROP INDEX IF EXISTS ${indexName(table, column.name)};\n` +
        `ALTER TABLE ${identifier(table)} DROP COLUMN ${identifier(column.name)};\n`,
    )
    .join("");
  return { ok: true, sql };
}

/**
 * The SQL for a migration named `name` with `columns`: a table created, columns added or removed,
 * or an empty migration. `keys` has each table's key type, for the columns that reference it.
 */
export function migrationFor(
  name: string,
  columns: readonly ColumnArg[],
  keys: ReadonlyMap<string, string>,
  options: MigrationChange["options"] = {},
): SqlResult {
  const plan = migrationPlan(name);
  if (plan.kind === "empty") {
    return columns.length > 0
      ? {
          ok: false,
          error: `${name}: columns only go with Create…, Add…To… or Remove…From… migrations`,
        }
      : { ok: true, sql: "-- Write the migration's SQL here.\n" };
  }
  if (columns.length === 0 && plan.kind !== "create") {
    return { ok: false, error: `${name}: name the columns to ${plan.kind} (sku:string)` };
  }
  if (plan.kind === "create")
    return { ok: true, sql: createTable(plan.table, columns, keys, options) };
  if (plan.kind === "remove") return removeColumns(plan.table, columns);
  return addColumns(plan.table, columns, keys);
}

/** Notes for references to tables the migrations don't make yet: their key type is a guess. */
function referenceNotes(
  columns: readonly ColumnArg[],
  keys: ReadonlyMap<string, string>,
): string[] {
  return columns
    .filter((column) => column.type === "references" && !keys.has(column.references!))
    .map((column) => `${column.references} isn't in the migrations yet, so ${column.name} is TEXT`);
}

/** A migration's SQL, for SQLite as D1 runs it, with a note for each key type it guessed. */
export function migration({ name, columns, keys, options }: MigrationChange): MigrationResult {
  const result = migrationFor(name, columns, keys, options);
  if (!result.ok) return result;
  const notes = referenceNotes(columns, keys);
  return notes.length === 0 ? result : { ...result, notes };
}
