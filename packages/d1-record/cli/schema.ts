// Applies a database's migrations to in-memory SQLite and reads back its tables and columns.
import type { DatabaseSync } from "node:sqlite";
import {
  generatedSchema,
  type Migration,
  type SchemaResult,
} from "@forestfuture/active-record/cli";
import { convert, type Column } from "./conventions.ts";

interface Options {
  /** Wrangler's record of applied migrations (`migrations_table`), left out of the schema. */
  migrationsTable?: string;
}

/** Each table's definition (`CREATE TABLE …`), by name. */
function definitions(db: DatabaseSync): Map<string, string> {
  const rows = db.prepare("SELECT name, sql FROM sqlite_master WHERE type = 'table'").all();
  return new Map(rows.map((row) => [String(row.name), String(row.sql)]));
}

/**
 * Applies the migrations in order to an in-memory SQLite database, noting which one last
 * changed each table. A migration that fails is reported by its file name.
 */
function applied(migrations: readonly Migration[]): {
  db?: DatabaseSync;
  changedBy: Map<string, string>;
  error?: string;
} {
  const changedBy = new Map<string, string>();
  // Loaded when used: the plugin refuses a Node without it before any command starts.
  const { DatabaseSync: Database } = process.getBuiltinModule("node:sqlite");
  const db = new Database(":memory:");
  let before = definitions(db);
  for (const { name, sql } of migrations) {
    try {
      db.exec(sql);
    } catch (error) {
      return { changedBy, error: `${name}: ${(error as Error).message}` };
    }
    const after = definitions(db);
    for (const [table, definition] of after) {
      if (before.get(table) !== definition) changedBy.set(table, name);
    }
    before = after;
  }
  return { db, changedBy };
}

/**
 * The tables a Model can be built on: not SQLite's, Cloudflare's or Wrangler's own, and not a
 * virtual table (full-text search, say) or the shadow tables SQLite keeps for one.
 */
function ownTables(all: Map<string, string>, migrationsTable: string): [string, string][] {
  const virtual = [...all]
    .filter(([, sql]) => /^CREATE\s+VIRTUAL\s+TABLE/i.test(sql))
    .map(([name]) => name);
  const shadow = (name: string) =>
    virtual.some((table) => name === table || name.startsWith(`${table}_`));
  const internal = (name: string) =>
    name.startsWith("sqlite_") || name.startsWith("_cf_") || name === migrationsTable;
  return [...all].filter(([name]) => !internal(name) && !shadow(name));
}

/** The columns `json_valid` checks in a table's definition: `CHECK (json_valid(settings))`. */
function jsonChecked(definition: string): Set<string> {
  const pattern = /json_valid\(\s*(?:"([^"]+)"|`([^`]+)`|\[([^\]]+)\]|(\w+))\s*\)/gi;
  return new Set([...definition.matchAll(pattern)].map((match) => match.slice(1).find(Boolean)!));
}

/** The declared type of each column a foreign key references, by the referencing column. */
function referencedTypes(db: DatabaseSync, table: string): Map<string, string> {
  const keys = db
    .prepare('SELECT "from", "table", "to" FROM pragma_foreign_key_list(?)')
    .all(table);
  const types = new Map<string, string>();
  for (const key of keys) {
    const columns = db
      .prepare("SELECT name, type, pk FROM pragma_table_info(?)")
      .all(String(key.table));
    // A key that names no column points at the parent's primary key.
    const target = columns.find((column) =>
      key.to === null ? Number(column.pk) > 0 : column.name === key.to,
    );
    if (target !== undefined) types.set(String(key.from), String(target.type));
  }
  return types;
}

/** A table's columns, as the conventions read them. */
function columnsOf(db: DatabaseSync, table: string, definition: string): Column[] {
  const json = jsonChecked(definition);
  const referenced = referencedTypes(db, table);
  return db
    .prepare('SELECT name, type, "notnull", dflt_value, pk FROM pragma_table_info(?)')
    .all(table)
    .map((row) => ({
      table,
      name: String(row.name),
      declaredType: String(row.type),
      notNull: row.notnull === 1,
      defaultValue: row.dflt_value === null ? null : String(row.dflt_value),
      primaryKey: Number(row.pk) > 0,
      jsonChecked: json.has(String(row.name)),
      referencedType: referenced.get(String(row.name)),
    }));
}

/** The error for a table without a primary key, saying what D1 takes. */
const missingKey = (name: string) =>
  `${name}: no primary key; d1-record needs one (id INTEGER PRIMARY KEY, or id TEXT PRIMARY KEY)`;

/**
 * The tables a project's migrations make, by active-record's conventions (#66): applied in order to
 * an in-memory SQLite database (`node:sqlite`), then read column by column. Tables are in
 * alphabetical order and columns in the table's order, so the result only changes with the
 * schema. SQLite's, Cloudflare's and Wrangler's own tables, and views, are left out.
 */
export function schemaOf(migrations: readonly Migration[], options: Options = {}): SchemaResult {
  const { db, changedBy, error } = applied(migrations);
  if (db === undefined) return { ok: false, errors: [error!] };
  const migrationsTable = options.migrationsTable ?? "d1_migrations";
  const tables = ownTables(definitions(db), migrationsTable).map(([name, definition]) => ({
    name,
    columns: columnsOf(db, name, definition),
    lastChangedBy: changedBy.get(name)!,
  }));
  db.close();
  return generatedSchema(tables, { convert, missingKey });
}
