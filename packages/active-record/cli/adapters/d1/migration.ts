// A generated migration's SQL, for SQLite as D1 runs it: the dialect the core's generator writes it in.
import {
  indexName,
  migrationSql,
  quotedName,
  type ColumnArg,
  type MigrationChange,
  type MigrationDialect,
  type MigrationResult,
} from "@forestfuture/active-record/cli";

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

/** SQLite's SQL for a generated migration. */
const sqlite: MigrationDialect = {
  reserved: keywords,
  types: {
    string: "TEXT",
    integer: "INTEGER",
    real: "REAL",
    boolean: "BOOLEAN",
    datetime: "DATETIME",
    json: "TEXT",
  },
  // A TEXT key is made in code (ADR-0013); an INTEGER PRIMARY KEY is D1's rowid.
  key: (integerId) => (integerId ? "id INTEGER PRIMARY KEY" : "id TEXT PRIMARY KEY NOT NULL"),
  timestampType: "DATETIME",
  guessedKeyType: "TEXT",
  check: (column, name) => (column.type === "json" ? `CHECK (json_valid(${name}))` : undefined),
  addRefusal: (table, column) =>
    column.type !== "references" && column.notNull && column.default === undefined
      ? `${table}.${column.name}: SQLite can't add a NOT NULL column without a default; give one (${column.name}:${column.type}!=…) or leave out the !`
      : undefined,
  // SQLite can't drop an indexed column, so the index the generators would have made goes first.
  dropColumn: (table, column) =>
    `DROP INDEX IF EXISTS ${indexName(table, column)};\n` +
    `ALTER TABLE ${quotedName(sqlite, table)} DROP COLUMN ${quotedName(sqlite, column)};\n`,
};

/**
 * The SQL for a migration named `name` with `columns`: a table created, columns added or removed,
 * or an empty migration. `keys` has each table's key type, for the columns that reference it.
 */
export function migrationFor(
  name: string,
  columns: readonly ColumnArg[],
  keys: ReadonlyMap<string, string>,
  options: MigrationChange["options"] = {},
): { ok: true; sql: string } | { ok: false; error: string } {
  const result = migrationSql({ name, columns, keys, options }, sqlite);
  return result.ok ? { ok: true, sql: result.sql } : result;
}

/** A migration's SQL, for SQLite as D1 runs it, with a note for each key type it guessed. */
export function migration(change: MigrationChange): MigrationResult {
  return migrationSql(change, sqlite);
}
