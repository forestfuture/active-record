// Reads a column as an attribute by the conventions (#66): name, type, nullability, default.
import { type EpochStorage, epochStorages, underscore } from "@forestfuture/active-record/cli";
import { attributeName } from "../project/names.ts";

type AttributeType = "string" | "integer" | "real" | "boolean" | "datetime" | "json";

/** A default the generated spec carries: a literal value, or a date. */
export type Default = { literal: unknown } | { date: string };

/** One attribute as the generated schema declares it, the shape `Model.define({...})` takes. */
export interface Spec {
  type: AttributeType;
  null?: false;
  column?: string;
  default?: Default;
  /** A key made in code by the Model's `generateId` (#99). */
  generateId?: true;
}

/** One column as SQLite describes it (`pragma_table_info`), with what the table adds to it. */
export interface Column {
  table: string;
  name: string;
  declaredType: string;
  notNull: boolean;
  defaultValue: string | null;
  primaryKey: boolean;
  /** Checked with `json_valid` in the table's definition. */
  jsonChecked: boolean;
  /** The declared type of the column a foreign key references, if it has one. */
  referencedType: string | undefined;
}

/** What a column became, or why it can't be one, plus a note when its type was guessed. */
export type Converted =
  | { ok: true; attribute: string; spec: Spec; note?: string; textDate?: true }
  | { ok: false; error: string };

const declaredTypes: readonly (readonly [RegExp, AttributeType])[] = [
  [/^BOOL/, "boolean"],
  [/^(DATETIME|TIMESTAMP|DATE)$/, "datetime"],
  [/^JSON$/, "json"],
  [/INT/, "integer"],
  [/CHAR|CLOB|TEXT/, "string"],
  [/REAL|FLOA|DOUB/, "real"],
];

/** The declared type's name, without its size or precision: `VARCHAR(40)` → `VARCHAR`. */
function baseType(declared: string): string {
  return declared
    .toUpperCase()
    .replace(/\(.*\)/, "")
    .trim();
}

/** Why a declared type can't be an attribute, if it can't. */
function unsupported(declared: string, name: string, where: string): string | undefined {
  if (/^(NUMERIC|DECIMAL)$/.test(declared)) {
    return `${where}: ${declared} loses precision as a number; store money as integer cents (${name}_cents INTEGER)`;
  }
  return declared === "BLOB" ? `${where}: BLOB columns aren't supported yet (#20)` : undefined;
}

/** Drizzle's `mode` for each epoch storage, which a note names for a reader with its schema open. */
const drizzleModes: Record<EpochStorage, string> = {
  unixSeconds: '"timestamp"',
  unixMilliseconds: '"timestamp_ms"',
};

/** The override that reads a Unix time as a `Date`, for a note; with Drizzle's modes named if asked. */
export function storageOverride(withDrizzleModes: boolean): string {
  const storages = epochStorages.map((storage) =>
    withDrizzleModes ? `"${storage}" (${drizzleModes[storage]})` : `"${storage}"`,
  );
  return `{ type: "datetime", storage: ${storages.join(" or ")} }`;
}

/** A default that's a number or an epoch function, which a datetime in ISO text wouldn't hold. */
const epochDefault = /^\(?\s*-?\d+(\.\d+)?\s*\)?$|unixepoch|strftime\s*\(\s*'%s'/i;

/** A note for a datetime column whose default looks like a Unix time (#73). */
function epochDefaultNote(column: Column, type: AttributeType): string | undefined {
  if (type !== "datetime" || column.defaultValue === null) return undefined;
  if (!epochDefault.test(column.defaultValue.trim())) return undefined;
  return (
    `${column.table}.${column.name}: a datetime with a number as its default; ` +
    `if it holds a Unix time, override it in its Model as ${storageOverride(false)}`
  );
}

/** A column's attribute type: its declared type first, then its name for plain TEXT/INTEGER. */
function typeOf(column: Column): { type?: AttributeType; error?: string; note?: string } {
  const declared = baseType(column.declaredType || (column.referencedType ?? ""));
  const where = `${column.table}.${column.name}`;
  const error = unsupported(declared, column.name, where);
  if (error !== undefined) return { error };
  return typeOfDeclared(column, declared, where);
}

/** The attribute type for a supported declared type; a guess (`string`) comes with a note (#159). */
function typeOfDeclared(
  column: Column,
  declared: string,
  where: string,
): { type: AttributeType; note?: string } {
  const matched = declaredTypes.find(([pattern]) => pattern.test(declared))?.[1];
  if ((matched === undefined || matched === "string") && column.jsonChecked) {
    return { type: "json" };
  }
  if (matched === undefined) return { type: "string", note: unmatchedNote(declared, where) };
  return declared === "TEXT" || declared === "INTEGER"
    ? refinedByName(column, matched, where)
    : { type: matched };
}

/** A note for a column whose declared type is none of the types SQLite gives an affinity (#159). */
function unmatchedNote(declared: string, where: string): string {
  const named = declared === "" ? "has no declared type" : `is declared ${declared}`;
  return (
    `${where}: ${named}, so it's read as a string; a number in it fails when the record loads, ` +
    `so override it in its Model with the type it holds`
  );
}

/** A column declared exactly TEXT or INTEGER, refined by its name (Rails' conventions). */
function refinedByName(
  column: Column,
  type: AttributeType,
  where: string,
): { type: AttributeType; note?: string } {
  if (type === "string" && column.name.endsWith("_at")) return { type: "datetime" };
  const prefix = /^(is|has)_/.exec(column.name)?.[1];
  if (type === "integer" && prefix !== undefined && !column.primaryKey) {
    return { type: "boolean", note: `${where}: INTEGER read as boolean, from its ${prefix}_ name` };
  }
  return { type };
}

/** A quoted SQL string literal's text: `'it''s'` → `it's`; undefined if it isn't one. */
function quoted(value: string): string | undefined {
  return /^'(?:[^']|'')*'$/.test(value) ? value.slice(1, -1).replaceAll("''", "'") : undefined;
}

function booleanDefault(value: string): Default | undefined {
  if (/^(TRUE|1)$/i.test(value)) return { literal: true };
  return /^(FALSE|0)$/i.test(value) ? { literal: false } : undefined;
}

/** A number, when JavaScript holds it exactly; larger integers are left to D1. */
function numberDefault(value: string, type: AttributeType): Default | undefined {
  if (type === "integer" && /^(TRUE|FALSE)$/i.test(value))
    return { literal: /^TRUE$/i.test(value) ? 1 : 0 };
  if (!/^-?\d+(\.\d+)?$/.test(value)) return undefined;
  const number = Number(value);
  return type === "integer" && !Number.isSafeInteger(number) ? undefined : { literal: number };
}

/** A quoted default for a json column (its JSON) or a datetime column (its date). */
function textDefault(text: string, type: AttributeType): Default | undefined {
  if (type === "string") return { literal: text };
  if (type === "datetime") return Number.isNaN(Date.parse(text)) ? undefined : { date: text };
  try {
    return { literal: JSON.parse(text) as unknown };
  } catch {
    return undefined;
  }
}

/** A SQL literal default as a value of the attribute's type; undefined for anything else. */
function literalDefault(sql: string | null, type: AttributeType): Default | undefined {
  if (sql === null) return undefined;
  const value = sql.trim();
  if (type === "boolean") return booleanDefault(value);
  if (type === "integer" || type === "real") return numberDefault(value, type);
  const text = quoted(value);
  return text === undefined ? undefined : textDefault(text, type);
}

/** A default that SQLite writes as date text with a space (`2026-10-12 06:38:30`), not ISO. */
const dateTextDefault = /^\(?\s*(current_timestamp|datetime\s*\(\s*'now'[^)]*\))\s*\)?$/i;

/** Whether a datetime column's default writes SQLite's date text, which sorts apart from ISO (#143). */
function hasDateTextDefault(column: Column, type: AttributeType): boolean {
  return type === "datetime" && dateTextDefault.test(column.defaultValue?.trim() ?? "");
}

/** A column's spec: nullability, a mapped column name, and its default or generated key. */
function specOf(column: Column, type: AttributeType, attribute: string): Spec {
  const spec: Spec = { type };
  if (column.notNull || column.primaryKey) spec.null = false;
  if (underscore(attribute) !== column.name) spec.column = column.name;
  // A key's own literal default wins; a TEXT key without one is generated in code.
  const defaultValue = literalDefault(column.defaultValue, type);
  if (defaultValue !== undefined) spec.default = defaultValue;
  else if (column.primaryKey && type === "string") spec.generateId = true;
  return spec;
}

/** A column as an attribute, by the conventions (#66): name, type, nullability and default. */
export function convert(column: Column): Converted {
  const { type, error, note: typeNote } = typeOf(column);
  if (type === undefined) return { ok: false, error: error! };
  const note = typeNote ?? epochDefaultNote(column, type);
  const attribute = attributeName(column.name);
  return {
    ok: true,
    attribute,
    spec: specOf(column, type, attribute),
    ...(note !== undefined && { note }),
    ...(hasDateTextDefault(column, type) && { textDate: true as const }),
  };
}
