// Reads a column as an attribute by the conventions (#66): name, type, nullability, default.
import {
  attributeName,
  castDefault,
  storageOverride,
  underscore,
  withGeneratedEnum,
  type Converted,
  type Default,
  type Spec,
  withDigits,
} from "@forestfuture/active-record/cli";

type AttributeType = Spec["type"];

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
  /** The names a `CHECK (… IN …)` in the table's definition restricts it to (#64). */
  restrictedTo?: readonly string[];
}

const declaredTypes: readonly (readonly [RegExp, AttributeType])[] = [
  [/^BOOL/, "boolean"],
  [/^(DATETIME|TIMESTAMP)$/, "datetime"],
  [/^DATE$/, "date"],
  [/^TIME$/, "time"],
  [/^(NUMERIC|DECIMAL)$/, "decimal"],
  [/^JSON$/, "json"],
  [/^BLOB$/, "binary"],
  [/INT/, "integer"],
  [/CHAR|CLOB|TEXT/, "string"],
  [/REAL|FLOA|DOUB/, "real"],
];

/** The declared type's name, without its size or precision: `VARCHAR(40)` → `VARCHAR`. */
function baseType(declared: string): string {
  // From the first ( to the last ), found by index: /\(.*\)/ rescans from each ( of a run.
  const open = declared.indexOf("(");
  const close = declared.lastIndexOf(")");
  const base =
    open !== -1 && close > open ? declared.slice(0, open) + declared.slice(close + 1) : declared;
  return base.toUpperCase().trim();
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
function typeOf(column: Column): { type: AttributeType; note?: string } {
  const declared = baseType(column.declaredType || (column.referencedType ?? ""));
  return typeOfDeclared(column, declared, `${column.table}.${column.name}`);
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

/**
 * A column declared exactly TEXT or INTEGER, refined by its name: `created_at` a datetime,
 * `is_active` a boolean, and so on.
 */
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

/**
 * A quoted default's text as the attribute's: a string's as it is, a date's or a time's in its
 * one form (#391), a datetime's as its date, and a json column's as its JSON.
 */
function textDefault(text: string, type: AttributeType): Default | undefined {
  if (type === "string") return { literal: text };
  if (type === "date" || type === "time") return castDefault(type, text);
  if (type === "datetime") return Number.isNaN(Date.parse(text)) ? undefined : { date: text };
  try {
    return { literal: JSON.parse(text) as unknown };
  } catch {
    return undefined;
  }
}

/** A SQL literal default as a value of the attribute's type; undefined for anything else. */
function literalDefault(sql: string | null, { type, precision, scale }: Spec): Default | undefined {
  // A spec has no literal for bytes, so a binary column's default stays with D1 (#20).
  if (sql === null || type === "binary") return undefined;
  const value = sql.trim();
  if (type === "boolean") return booleanDefault(value);
  if (type === "integer" || type === "real") return numberDefault(value, type);
  // Rounded to the column's scale, and left to D1 past its precision, as an assigned value (#398).
  if (type === "decimal") return castDefault(type, quoted(value) ?? value, { precision, scale });
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
  const spec: Spec = withSizeDigits({ type }, column.declaredType);
  if (column.notNull || column.primaryKey) spec.null = false;
  if (underscore(attribute) !== column.name) spec.column = column.name;
  // A key's own literal default wins; a TEXT key without one is generated in code.
  const defaultValue = literalDefault(column.defaultValue, spec);
  if (defaultValue !== undefined) spec.default = defaultValue;
  else if (column.primaryKey && type === "string") spec.generateId = true;
  return withGeneratedEnum(spec, column.restrictedTo);
}

/**
 * A decimal's precision and scale from its declared type's size: `DECIMAL(10, 2)` gives 10 and
 * 2, `NUMERIC(6)` a precision of 6 (#398). A size that isn't whole numbers gives neither.
 */
function withSizeDigits(spec: Spec, declared: string): Spec {
  const open = declared.indexOf("(");
  const close = declared.indexOf(")", open);
  if (open === -1 || close === -1) return spec;
  const digits = declared
    .slice(open + 1, close)
    .split(",")
    .map((part) => part.trim());
  if (digits.length > 2 || !digits.every((part) => /^\d+$/.test(part))) return spec;
  const [precision, scale] = digits.map(Number);
  return withDigits(spec, precision, scale);
}

/** A column as an attribute, by the conventions (#66): name, type, nullability and default. */
export function convert(column: Column): Converted {
  const { type, note: typeNote } = typeOf(column);
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
