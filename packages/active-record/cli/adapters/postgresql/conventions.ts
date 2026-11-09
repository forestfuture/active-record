// Reads a Postgres column as an attribute: its type from the catalog, its nullability, and its literal default.
import {
  attributeName,
  underscore,
  type Converted,
  type Default,
  type Spec,
} from "@forestfuture/active-record/cli";
import type { Column } from "./catalog.ts";

type AttributeType = Spec["type"];

/** Each base type an attribute holds, by its catalog name. */
const attributeTypes: Readonly<Record<string, AttributeType>> = {
  int2: "integer",
  int4: "integer",
  int8: "integer",
  float4: "real",
  float8: "real",
  bool: "boolean",
  date: "datetime",
  timestamp: "datetime",
  timestamptz: "datetime",
  json: "json",
  jsonb: "json",
  text: "string",
  varchar: "string",
  bpchar: "string",
  citext: "string",
  uuid: "string",
  name: "string",
};

/** Why a column's type can't be an attribute, if it can't. */
function refusal(column: Column, where: string): string | undefined {
  if (column.category === "A") {
    return `${where}: arrays (${column.declared}) aren't supported; use a jsonb column, or a table`;
  }
  if (column.base === "numeric") {
    return `${where}: numeric loses precision as a number; store money as integer cents (${column.name}_cents BIGINT)`;
  }
  return column.base === "bytea" ? `${where}: bytea columns aren't supported yet (#20)` : undefined;
}

/** A column's attribute type, and a note when it's a string for want of a better one. */
function typeOf(column: Column, where: string): { type: AttributeType; note?: string } {
  const type = attributeTypes[column.base];
  if (type !== undefined) return { type };
  // An enum's labels are text.
  if (column.kind === "e") return { type: "string" };
  return {
    type: "string",
    note: `${where}: is ${column.declared}, so it's read as a string; override it in its Model if it holds another type`,
  };
}

/** A cast Postgres adds to a default: `::text`, `::character varying(40)`, `::mood`. */
const casts = String.raw`(?:::[\w ."]+(?:\([\d, ]+\))?)*`;

/** A default's literal text, with its casts taken off: `'it''s'::text` → `it's`, `1.5` → `1.5`. */
function literalText(sql: string): string | undefined {
  const quoted = new RegExp(`^'((?:[^']|'')*)'${casts}$`).exec(sql);
  if (quoted !== null) return quoted[1]!.replaceAll("''", "'");
  const bare = new RegExp(String.raw`^\(?(-?\d+(?:\.\d+)?|true|false)\)?${casts}$`, "i").exec(sql);
  return bare?.[1];
}

/** A number, when JavaScript holds it exactly. */
function numberDefault(text: string, type: AttributeType): Default | undefined {
  if (!/^-?\d+(\.\d+)?$/.test(text)) return undefined;
  const number = Number(text);
  return type === "integer" && !Number.isSafeInteger(number) ? undefined : { literal: number };
}

/** JSON's value, or a date's text, when it parses. */
function parsedDefault(text: string, type: "json" | "datetime"): Default | undefined {
  if (type === "datetime") return Number.isNaN(Date.parse(text)) ? undefined : { date: text };
  try {
    return { literal: JSON.parse(text) as unknown };
  } catch {
    return undefined;
  }
}

/** A literal default as a value of the attribute's type; undefined for a function or anything else. */
function literalDefault(sql: string | null, type: AttributeType): Default | undefined {
  const text = sql === null ? undefined : literalText(sql.trim());
  if (text === undefined) return undefined;
  if (type === "boolean")
    return /^(true|false)$/i.test(text) ? { literal: /^true$/i.test(text) } : undefined;
  if (type === "integer" || type === "real") return numberDefault(text, type);
  return type === "string" ? { literal: text } : parsedDefault(text, type);
}

/** A column's spec: nullability, a mapped column name, and its default or a key made in code. */
function specOf(column: Column, type: AttributeType, attribute: string): Spec {
  const spec: Spec = { type };
  if (column.notNull || column.primaryKey) spec.null = false;
  if (underscore(attribute) !== column.name) spec.column = column.name;
  // A key's own literal default wins; any other string key is made in code (ADR-0013).
  const defaultValue = literalDefault(column.defaultValue, type);
  if (defaultValue !== undefined) spec.default = defaultValue;
  else if (column.primaryKey && type === "string") spec.generateId = true;
  return spec;
}

/** A column as an attribute: its type, nullability and literal default, or why it can't be one. */
export function convert(column: Column): Converted {
  const where = `${column.table}.${column.name}`;
  const error = refusal(column, where);
  if (error !== undefined) return { ok: false, error };
  const { type, note } = typeOf(column, where);
  const attribute = attributeName(column.name);
  const spec = specOf(column, type, attribute);
  return note === undefined ? { ok: true, attribute, spec } : { ok: true, attribute, spec, note };
}
