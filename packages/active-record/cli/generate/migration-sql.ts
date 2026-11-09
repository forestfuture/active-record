// A generated migration's SQL, from what its name says to do and its columns, in a dialect each adapter's plugin supplies.
import type { MigrationChange, MigrationResult } from "../adapter.ts";
import type { ColumnArg } from "./columns.ts";
import { indexName, migrationPlan } from "./migration-plan.ts";

/** What a migration's SQL takes from its database: its names, types and keys, and what it can't do. */
export interface MigrationDialect {
  /** The words the database reserves, which a table or column named one is quoted for. */
  reserved: ReadonlySet<string>;
  /** Each column type's SQL; a reference takes its table's key type. */
  types: Readonly<Record<Exclude<ColumnArg["type"], "references">, string>>;
  /** The key column a new table gets: one made in code, or with `--id integer`, the database's. */
  key: (integerId: boolean) => string;
  /** The type of `created_at` and `updated_at`. */
  timestampType: string;
  /** The key type a reference takes when its table isn't in the migrations yet. */
  guessedKeyType: string;
  /** A check a column gets beside its type, such as one that its JSON is valid. */
  check?: (column: ColumnArg, name: string) => string | undefined;
  /** Why the database can't add this column to an existing table, if it can't. */
  addRefusal?: (table: string, column: ColumnArg) => string | undefined;
  /** The statements that drop a column (and what has to go first), each ending in `;\n`. */
  dropColumn: (table: string, column: string) => string;
}

type SqlResult = { ok: true; sql: string } | { ok: false; error: string };

/** A name as SQL: quoted only when the database reserves it, so migrations stay readable. */
export function quotedName(dialect: MigrationDialect, name: string): string {
  return dialect.reserved.has(name) ? `"${name}"` : name;
}

/** A default as a SQL literal: `TRUE`, `1.5`, `'it''s'`. */
function literal(value: string | number | boolean): string {
  if (typeof value === "boolean") return value ? "TRUE" : "FALSE";
  return typeof value === "number" ? String(value) : `'${value.replaceAll("'", "''")}'`;
}

/** What a migration's SQL is written with. */
interface Writing {
  dialect: MigrationDialect;
  keys: ReadonlyMap<string, string>;
}

/** A column's definition, as `CREATE TABLE` and `ADD COLUMN` write it. */
function definition(column: ColumnArg, { dialect, keys }: Writing, notNull: boolean): string {
  const name = quotedName(dialect, column.name);
  if (column.type === "references") {
    const type = (keys.get(column.references!) ?? dialect.guessedKeyType).toUpperCase();
    const target = quotedName(dialect, column.references!);
    return `${name} ${type}${notNull ? " NOT NULL" : ""} REFERENCES ${target} (id)`;
  }
  const parts = [name, dialect.types[column.type]];
  if (notNull) parts.push("NOT NULL");
  if (column.default !== undefined) parts.push(`DEFAULT ${literal(column.default)}`);
  const check = dialect.check?.(column, name);
  if (check !== undefined) parts.push(check);
  return parts.join(" ");
}

/** `CREATE [UNIQUE] INDEX` for each indexed column. */
function indexes(dialect: MigrationDialect, table: string, columns: readonly ColumnArg[]): string {
  return columns
    .filter((column) => column.index !== "none")
    .map((column) => {
      const unique = column.index === "unique" ? "UNIQUE " : "";
      const on = `${quotedName(dialect, table)} (${quotedName(dialect, column.name)})`;
      return `CREATE ${unique}INDEX ${indexName(table, column.name)} ON ${on};\n`;
    })
    .join("");
}

/** `CREATE TABLE`, with its key, columns, timestamps and indexes. */
function createTable(table: string, change: MigrationChange, writing: Writing): string {
  const { dialect } = writing;
  const lines = [dialect.key(change.options.integerId === true)];
  for (const column of change.columns) lines.push(definition(column, writing, column.notNull));
  if (change.options.timestamps !== false) {
    const type = dialect.timestampType;
    lines.push(`created_at ${type} NOT NULL`, `updated_at ${type} NOT NULL`);
  }
  const body = lines.join(",\n  ");
  return `CREATE TABLE ${quotedName(dialect, table)} (\n  ${body}\n);\n${indexes(dialect, table, change.columns)}`;
}

/** `ADD COLUMN` for each column; a reference added later can be null, as Rails' `add_reference`. */
function addColumns(table: string, columns: readonly ColumnArg[], writing: Writing): SqlResult {
  const { dialect } = writing;
  for (const column of columns) {
    const error = dialect.addRefusal?.(table, column);
    if (error !== undefined) return { ok: false, error };
  }
  const added = columns
    .map((column) => {
      const notNull = column.type !== "references" && column.notNull;
      const quoted = quotedName(dialect, table);
      return `ALTER TABLE ${quoted} ADD COLUMN ${definition(column, writing, notNull)};\n`;
    })
    .join("");
  return { ok: true, sql: added + indexes(dialect, table, columns) };
}

/** The SQL for the migration the change names, or why it can't be written. */
function migrationFor(change: MigrationChange, writing: Writing): SqlResult {
  const { name, columns } = change;
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
  if (plan.kind === "create") return { ok: true, sql: createTable(plan.table, change, writing) };
  if (plan.kind === "add") return addColumns(plan.table, columns, writing);
  const dropped = columns.map((column) => writing.dialect.dropColumn(plan.table, column.name));
  return { ok: true, sql: dropped.join("") };
}

/** Notes for references to tables the migrations don't make yet: their key type is a guess. */
function referenceNotes(change: MigrationChange, dialect: MigrationDialect): string[] {
  // A removed reference's type isn't written, so nothing was guessed.
  if (migrationPlan(change.name).kind === "remove") return [];
  return change.columns
    .filter((column) => column.type === "references" && !change.keys.has(column.references!))
    .map(
      (column) =>
        `${column.references} isn't in the migrations yet, so ${column.name} is ${dialect.guessedKeyType}`,
    );
}

/**
 * A migration's SQL in the dialect given: a table created, columns added or removed, or an empty
 * migration, as its name says (`CreateProducts`, `AddSkuToProducts`, …), with a note for each key
 * type it guessed.
 */
export function migrationSql(change: MigrationChange, dialect: MigrationDialect): MigrationResult {
  const result = migrationFor(change, { dialect, keys: change.keys });
  if (!result.ok) return result;
  const notes = referenceNotes(change, dialect);
  return notes.length === 0 ? result : { ...result, notes };
}
