// A database's tables as the generated schema declares them, from columns an adapter's reader has converted: keys, attribute names and export names checked.
import type { GeneratedTable, SchemaResult, Spec } from "../adapter.ts";
import { byName } from "../project/migrations.ts";
import { exportName } from "../project/names.ts";

/** What a column became, or why it can't be one, plus a note when its type was guessed. */
export type Converted =
  | { ok: true; attribute: string; spec: Spec; note?: string; textDate?: true }
  | { ok: false; error: string };

/** The least a reader knows of a column: its table, its name, and whether it's in the key. */
export interface ReadColumn {
  table: string;
  name: string;
  primaryKey: boolean;
}

/** A table an adapter read: its columns in order, and the migration that last changed it. */
export interface ReadTable<C extends ReadColumn> {
  name: string;
  columns: readonly C[];
  lastChangedBy: string;
  /** Its key column's type, as the database declares it, for the columns that reference it. */
  keyType?: string;
}

/** How an adapter reads its columns: each one converted, and what to say of a table without a key. */
export interface Reading<C extends ReadColumn> {
  convert: (column: C) => Converted;
  /** The error for a table with no primary key, saying what to give it. */
  missingKey: (table: string) => string;
}

/**
 * What reading columns turns up besides attributes: the errors that stop a schema, the notes to
 * print, and the datetime columns (`table.column`) whose default writes date text that sorts
 * apart from ISO text (#143).
 */
interface Findings {
  errors: string[];
  notes: string[];
  textDates: string[];
}

const noFindings = (): Findings => ({ errors: [], notes: [], textDates: [] });

function merge(into: Findings, from: Findings): void {
  into.errors.push(...from.errors);
  into.notes.push(...from.notes);
  into.textDates.push(...from.textDates);
}

/** A table's attributes, in column order, with what their columns turn up. */
function attributesOf<C extends ReadColumn>(
  columns: readonly C[],
  convert: Reading<C>["convert"],
): { attributes: Record<string, Spec> } & Findings {
  const attributes: Record<string, Spec> = {};
  const found = noFindings();
  const columnOf = new Map<string, string>();
  for (const column of columns) {
    const converted = convert(column);
    if (!converted.ok) {
      found.errors.push(converted.error);
      continue;
    }
    const { attribute, spec, note, textDate } = converted;
    const taken = columnOf.get(attribute);
    if (taken !== undefined) {
      found.errors.push(
        `${column.table}: columns ${taken} and ${column.name} would both be the attribute ${attribute}; rename one`,
      );
    }
    columnOf.set(attribute, column.name);
    attributes[attribute] = spec;
    if (note !== undefined) found.notes.push(note);
    if (textDate) found.textDates.push(`${column.table}.${column.name}`);
  }
  return { attributes, ...found };
}

/** One table's schema, or the errors that stop it from being generated. */
function tableSchema<C extends ReadColumn>(
  table: ReadTable<C>,
  reading: Reading<C>,
): { table?: GeneratedTable } & Findings {
  const { name, columns, lastChangedBy, keyType } = table;
  const keys = columns.filter((column) => column.primaryKey).map((column) => column.name);
  if (keys.length !== 1) {
    const error =
      keys.length === 0
        ? reading.missingKey(name)
        : `${name}: a composite primary key (${keys.join(", ")}) isn't supported; give the table a single key`;
    return { ...noFindings(), errors: [error] };
  }
  const { attributes, ...found } = attributesOf(columns, reading.convert);
  const generated = { name, exportName: exportName(name), primaryKey: keys[0]!, lastChangedBy };
  const known = keyType === undefined ? {} : { keyType };
  return { table: { ...generated, attributes, ...known }, ...found };
}

/** Tables whose names become the same export (`line_items`, `line-items` → `lineItems`). */
function exportCollisions(names: readonly string[]): string[] {
  const seen = new Map<string, string>();
  const errors: string[] = [];
  for (const name of names) {
    const as = exportName(name);
    const other = seen.get(as);
    if (other !== undefined) {
      errors.push(`${other} and ${name} would both be exported as ${as}; rename one of the tables`);
    }
    seen.set(as, name);
  }
  return errors;
}

/**
 * The generated schema's tables, from the tables an adapter read, in alphabetical order (so the
 * result only changes with the schema), or every error that stops them.
 */
export function generatedSchema<C extends ReadColumn>(
  read: readonly ReadTable<C>[],
  reading: Reading<C>,
): SchemaResult {
  const sorted = [...read].sort((a, b) => byName(a.name, b.name));
  const found = noFindings();
  found.errors.push(...exportCollisions(sorted.map((table) => table.name)));
  const tables: GeneratedTable[] = [];
  for (const table of sorted) {
    const result = tableSchema(table, reading);
    merge(found, result);
    if (result.table !== undefined) tables.push(result.table);
  }
  const { errors, notes, textDates } = found;
  return errors.length > 0 ? { ok: false, errors } : { ok: true, tables, notes, textDates };
}
