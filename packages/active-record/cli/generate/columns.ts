// Parses a generator's `name:type` column arguments.
import { pluralize } from "../../src/inflections.ts";
import { camelize, underscore } from "../../src/naming.ts";

type ColumnType = "string" | "integer" | "real" | "boolean" | "datetime" | "json" | "references";

/** One column as the generators' syntax gives it: `email:string!:unique`, `user:references`. */
export interface ColumnArg {
  /** The column's name, in snake_case (`user_id` for `user:references`). */
  name: string;
  type: ColumnType;
  notNull: boolean;
  index: "none" | "index" | "unique";
  /** A literal default, from `=value`. */
  default?: string | number | boolean;
  /** For `references`: the table it points at, and the `belongsTo` it suggests. */
  references?: string;
  association?: string;
}

const types: readonly ColumnType[] = [
  "string",
  "integer",
  "real",
  "boolean",
  "datetime",
  "json",
  "references",
];

// name[:type][!][=default][:unique|:index]…, where a missing type is string (`slug:index`),
// and a default runs to the index modifiers, so it may hold a `:` (`starts:string=09:00`).
const syntax =
  /^([A-Za-z_]\w*)(?::(?!(?:unique|index)\b)(\w+))?(!)?(?:=(.*?))?((?::(?:unique|index))*)$/;

type Literal = string | number | boolean;

/** A `=value` default as its type's literal, or why it can't be one. */
function defaultOf(
  type: ColumnType,
  value: string,
): { ok: true; value: Literal } | { ok: false; error: string } {
  const number = Number(value);
  switch (type) {
    case "string":
      return { ok: true, value };
    case "boolean":
      return value === "true" || value === "false"
        ? { ok: true, value: value === "true" }
        : { ok: false, error: `${value} isn't true or false` };
    case "integer":
      return /^-?\d+$/.test(value) && Number.isSafeInteger(number)
        ? { ok: true, value: number }
        : { ok: false, error: `${value} isn't an integer` };
    case "real":
      return /^-?\d+(\.\d+)?$/.test(value)
        ? { ok: true, value: number }
        : { ok: false, error: `${value} isn't a number` };
    default:
      return {
        ok: false,
        error: "only string, integer, real and boolean columns can have a default here",
      };
  }
}

/** The index `:unique` or `:index` asks for. */
function indexOf(modifiers: string): ColumnArg["index"] {
  if (modifiers.includes("unique")) return "unique";
  return modifiers.includes("index") ? "index" : "none";
}

/** One column argument, or why it can't be read. */
function parseColumn(arg: string): ColumnArg | string {
  const match = syntax.exec(arg);
  if (match === null) {
    return `${arg}: write a column as name:type, with ! for NOT NULL, =value for a default, and :unique or :index`;
  }
  const [, given, typeName = "string", bang, value, indexes = ""] = match;
  const type = typeName as ColumnType;
  if (!types.includes(type)) {
    return `${arg}: ${typeName} isn't a type; use string, integer, real, boolean, datetime, json or references`;
  }
  const name = underscore(given!);
  const index = indexOf(indexes);
  if (type === "references") {
    const association = camelize(name);
    return {
      name: `${name}_id`,
      type,
      notNull: true,
      index: index === "none" ? "index" : index,
      references: pluralize(name),
      association,
    };
  }
  const column: ColumnArg = { name, type, notNull: bang !== undefined, index };
  if (value === undefined) return column;
  const literal = defaultOf(type, value);
  return literal.ok ? { ...column, default: literal.value } : `${arg}: ${literal.error}`;
}

/** The columns given to a generator, or every one that can't be read. */
export function parseColumns(
  args: readonly string[],
): { ok: true; columns: ColumnArg[] } | { ok: false; errors: string[] } {
  const parsed = args.map(parseColumn);
  const errors = parsed.filter((each): each is string => typeof each === "string");
  return errors.length > 0 ? { ok: false, errors } : { ok: true, columns: parsed as ColumnArg[] };
}
