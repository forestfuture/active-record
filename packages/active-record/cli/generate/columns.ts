// Parses a generator's `name:type` column arguments.
import { pluralize } from "../../src/inflections.ts";
import { castDefault, type CastDefaultType, type Digits } from "../schema/cast-default.ts";
import { camelize, underscore } from "../../src/naming.ts";

type ColumnType =
  | "string"
  | "integer"
  | "real"
  | "decimal"
  | "boolean"
  | "datetime"
  | "date"
  | "time"
  | "json"
  | "binary"
  | "references";

/** One column as the generators' syntax gives it: `email:string!:unique`, `user:references`. */
export interface ColumnArg {
  /** The column's name, in snake_case (`user_id` for `user:references`). */
  name: string;
  type: ColumnType;
  notNull: boolean;
  index: "none" | "index" | "unique";
  /** A literal default, from `=value`. */
  default?: string | number | boolean;
  /** A decimal's digits in all and after the point, from `decimal{10,2}` (#398). */
  precision?: number;
  scale?: number;
  /** For `references`: the table it points at, and the `belongsTo` it suggests. */
  references?: string;
  association?: string;
}

const types: readonly ColumnType[] = [
  "string",
  "integer",
  "real",
  "decimal",
  "boolean",
  "datetime",
  "date",
  "time",
  "json",
  "binary",
  "references",
];

/** The types, as a message lists them: `string, integer, … or references`. */
const typeList = `${types.slice(0, -1).join(", ")} or ${types.at(-1)}`;

// name[:type][!][=default][:unique|:index]…, where a missing type is string (`slug:index`),
// and a default runs to the index modifiers, so it may hold a `:` (`starts:string=09:00`).
const syntax =
  /^([A-Za-z_]\w*)(?::(?!(?:unique|index)\b)(\w+)(?:\{(\d+)(?:,(\d+))?\})?)?(!)?(?:=(.*?))?((?::(?:unique|index))*)$/;

type Literal = string | number | boolean;

type Parsed = { ok: true; value: Literal } | { ok: false; error: string };

/** A decimal's, a date's or a time's default, in its one form (`1.50` → `"1.5"`, #391). */
const castParser =
  (type: CastDefaultType) =>
  (value: string, digits: Digits): Parsed => {
    const cast = castDefault(type, value, digits);
    return cast === undefined
      ? { ok: false, error: `${value} isn't a ${type}` }
      : { ok: true, value: cast.literal };
  };

/** How each type that can have a default reads a `=value` as its literal. */
const defaultParsers: Partial<Record<ColumnType, (value: string, digits: Digits) => Parsed>> = {
  string: (value) => ({ ok: true, value }),
  boolean: (value) =>
    value === "true" || value === "false"
      ? { ok: true, value: value === "true" }
      : { ok: false, error: `${value} isn't true or false` },
  integer: (value) =>
    /^-?\d+$/.test(value) && Number.isSafeInteger(Number(value))
      ? { ok: true, value: Number(value) }
      : { ok: false, error: `${value} isn't an integer` },
  real: (value) =>
    /^-?\d+(\.\d+)?$/.test(value)
      ? { ok: true, value: Number(value) }
      : { ok: false, error: `${value} isn't a number` },
  decimal: castParser("decimal"),
  date: castParser("date"),
  time: castParser("time"),
};

/** The types that can have a default, as a message lists them: `string, integer, … and time`. */
const defaultTypes = types.filter((type) => defaultParsers[type] !== undefined);
const defaultTypeList = `${defaultTypes.slice(0, -1).join(", ")} and ${defaultTypes.at(-1)}`;

/** A `=value` default as its type's literal, or why it can't be one. */
function defaultOf(type: ColumnType, value: string, digits: Digits): Parsed {
  const parse = defaultParsers[type];
  return parse === undefined
    ? { ok: false, error: `only ${defaultTypeList} columns can have a default here` }
    : parse(value, digits);
}

/** A column's `{precision,scale}`, which only a decimal takes, or why it can't have them (#398). */
function digitsOf(type: ColumnType, precision?: string, scale?: string): Digits | string {
  if (precision === undefined) return {};
  if (type !== "decimal") return "only a decimal takes a precision and scale, as decimal{10,2}";
  const digits = {
    precision: Number(precision),
    ...(scale !== undefined && { scale: Number(scale) }),
  };
  return (digits.scale ?? 0) > digits.precision
    ? `its scale, ${digits.scale}, is past its precision, ${digits.precision}`
    : digits;
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
  const [, given, typeName = "string", precision, scale, bang, value, indexes = ""] = match;
  const type = typeName as ColumnType;
  if (!types.includes(type)) {
    return `${arg}: ${typeName} isn't a type; use ${typeList}`;
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
  const digits = digitsOf(type, precision, scale);
  if (typeof digits === "string") return `${arg}: ${digits}`;
  const column: ColumnArg = { name, type, notNull: bang !== undefined, index, ...digits };
  if (value === undefined) return column;
  const literal = defaultOf(type, value, digits);
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
