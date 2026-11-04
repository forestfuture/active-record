// Converting values between attribute types and what D1 stores, per attribute type.
import type { EpochStorage } from "./epoch-storage.ts";
import type { AttributeDefinition, AttributeType } from "./metadata.ts";

/** A value that can't be read as the attribute's type. */
export const uncastable = Symbol("uncastable");

interface Converter {
  /**
   * An assigned value or a condition's (#81) → the attribute's JavaScript value, or
   * `uncastable`. Only what's unambiguous is accepted, so a value from JSON, a form or a query
   * string can't be read as something it isn't. Never called with null.
   */
  cast(value: unknown): unknown;
  /**
   * D1 value → JavaScript value, or `uncastable` for a stored value that isn't one: a boolean
   * other than 0 and 1, text in an integer column, a json cell that isn't JSON, a Unix time past
   * the range of a `Date` (#73, #146, #159). Never called with null.
   */
  read(value: unknown): unknown;
  /** JavaScript value → D1 value. Never called with null. */
  write(value: unknown): unknown;
}

const identity = (value: unknown) => value;

/**
 * What an attribute's values convert by: its type, and for a datetime kept as a Unix time, its
 * storage (#73). Passed whole, so a caller can't convert by the type alone and skip the storage.
 */
export type Convertible = Pick<AttributeDefinition, "type" | "storage">;

/** The key of the converter for an attribute: its storage if it has one, else its type. */
type ConversionKey = AttributeType | EpochStorage;

const keyOf = ({ type, storage }: Convertible): ConversionKey => storage ?? type;

const converters: Record<ConversionKey, Converter> = {
  string: { cast: text, read: text, write: identity },
  integer: { cast: castInteger, read: safeInteger, write: identity },
  real: { cast: castReal, read: finiteNumber, write: identity },
  boolean: { cast: castBoolean, read: readBoolean, write: (value) => (value ? 1 : 0) },
  datetime: {
    cast: castDatetime,
    read: readDatetime,
    write: (value) => (value as Date).toISOString(),
  },
  unixSeconds: {
    cast: castDatetime,
    read: unixTime(1000),
    write: (value) => Math.floor((value as Date).getTime() / 1000),
  },
  unixMilliseconds: {
    cast: castDatetime,
    read: unixTime(1),
    write: (value) => (value as Date).getTime(),
  },
  json: { cast: castJson, read: readJson, write: (value) => JSON.stringify(value) },
};

/** `value` as the attribute's type (null stays null), or `uncastable`. */
export function castValue(attribute: Convertible, value: unknown): unknown {
  return value === null ? null : converters[keyOf(attribute)].cast(value);
}

/**
 * A condition's value as the attribute's type, or `uncastable`: as `castValue`, except that a
 * finite number matches a string attribute as its decimal string (`7` → `"7"`), as `find` does
 * for a text key and as Rails does, so a foreign key of another type still finds its target.
 */
export function castCondition(attribute: Convertible, value: unknown): unknown {
  if (attribute.type === "string" && typeof value === "number" && Number.isFinite(value)) {
    return String(value);
  }
  return castValue(attribute, value);
}

/**
 * A stored value as the attribute's, or `uncastable` for one that isn't. `Attribute#read`, in
 * attribute.ts, is how a cell D1 returned is read, so it fails naming its attribute.
 */
export function readValue(attribute: Convertible, value: unknown): unknown {
  return value === null || value === undefined ? null : converters[keyOf(attribute)].read(value);
}

export function writeValue(attribute: Convertible, value: unknown): unknown {
  return value === null || value === undefined ? null : converters[keyOf(attribute)].write(value);
}

/**
 * Converts a value with no declared attribute type (e.g. one interpolated into
 * an `sql` fragment) using the converter its runtime type implies, so it's
 * stored the same way as an attribute of that type.
 */
export function writeUntypedValue(value: unknown): unknown {
  if (value instanceof Date) return writeValue({ type: "datetime" }, value);
  if (typeof value === "boolean") return writeValue({ type: "boolean" }, value);
  return value;
}

const booleans = new Map<unknown, boolean>([
  [true, true],
  [false, false],
  [1, true],
  [0, false],
  ["1", true],
  ["0", false],
  ["true", true],
  ["false", false],
  ["on", true],
  ["off", false],
]);

/** `true`/`false`, `1`/`0`, `"1"`/`"0"`, and `"true"`/`"false"` or `"on"`/`"off"` in any case. */
function castBoolean(value: unknown): unknown {
  const key = typeof value === "string" ? value.toLowerCase() : value;
  return booleans.has(key) ? booleans.get(key) : uncastable;
}

/**
 * Any value JSON can write, as it is. What `stringify` writes lossily (a `Map` as `{}`, `NaN` as
 * `null`) is kept; what it throws on (a BigInt, a cycle) or gives nothing for (a function, a
 * symbol) is refused (#146). It's checked here, and written again at save, so a value is
 * refused where it's assigned rather than where it's stored, and the cost is one more
 * `stringify` per assignment.
 */
function castJson(value: unknown): unknown {
  try {
    return JSON.stringify(value) === undefined ? uncastable : value;
  } catch {
    return uncastable;
  }
}

/**
 * Text is parsed; one that isn't JSON is `uncastable`. Under a column declared JSON, SQLite
 * stores a number-like value (123) as a number, and D1 returns it as one, which is already the
 * value.
 */
function readJson(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return uncastable;
  }
}

/** A whole number, signed, with nothing else but spaces around it. */
const integerText = /^\s*[+-]?\d+\s*$/;

/**
 * A decimal number, with an optional exponent (`1.5`, `-2e3`, `.5`), and spaces around it.
 * Digits after the point only follow a point, so no run of digits can match two ways: an
 * optional point between two runs of digits backtracks quadratically on a long string (ReDoS).
 */
const realText = /^\s*[+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?\s*$/i;

/** `value` as a number: a number as it is, or a string matching `pattern`; else `uncastable`. */
function numberFrom(value: unknown, pattern: RegExp): unknown {
  if (typeof value === "number") return value;
  return typeof value === "string" && pattern.test(value) ? Number(value) : uncastable;
}

/** `value` if it's text, else `uncastable`. */
function text(value: unknown): unknown {
  return typeof value === "string" ? value : uncastable;
}

/** `value` if it's a safe integer, else `uncastable`. */
function safeInteger(value: unknown): unknown {
  return Number.isSafeInteger(value) ? value : uncastable;
}

/** `value` if it's a finite number, else `uncastable`. */
function finiteNumber(value: unknown): unknown {
  return Number.isFinite(value) ? value : uncastable;
}

/** A safe integer, or a string that's wholly one: `1.7`, `"12abc"` and `"1e3"` aren't. */
function castInteger(value: unknown): unknown {
  return safeInteger(numberFrom(value, integerText));
}

/** A finite number, or a string that's wholly a decimal number. */
function castReal(value: unknown): unknown {
  return finiteNumber(numberFrom(value, realText));
}

/** A Unix time of this many milliseconds per unit as a `Date`; anything but a number is `uncastable`. */
function unixTime(millisecondsPer: number): (value: unknown) => unknown {
  return (value) =>
    typeof value === "number" ? validDate(new Date(value * millisecondsPer)) : uncastable;
}

/** An ISO-8601 date: `2026-01-02`, read as midnight UTC. */
const isoDate = /^(\d{4})-(\d{2})-(\d{2})$/;

/** An ISO-8601 date and time, with `Z` or an offset: a time without one is ambiguous. */
const isoDateTime =
  /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d{1,9})?)?(?:Z|[+-]\d{2}:\d{2})$/;

/** A stored date and time with no zone, as SQLite's `CURRENT_TIMESTAMP` writes it: UTC (#73). */
export const zonelessDateTime = /^\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?$/;

/** What `toISOString` writes, the form datetimes are stored in: `2026-01-02T03:04:05.678Z`. */
const isoStringForm = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/** What `toISOString` writes for a year outside 0000-9999: a sign and six digits (`+010000-…`). */
const expandedYearDateTime = /^[+-]\d{6}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;

/**
 * A stored datetime as a `Date`: text in a form an assignment accepts (an ISO date, or a date and
 * time with its offset), what `toISOString` writes for a far year, or SQLite's own, with no
 * zone, which is UTC, where `new Date` would read it in the process's time zone. A number isn't
 * one: it's a Unix time (#73), and read as a time in ISO text it would be a moment in January
 * 1970 (#159).
 */
function readDatetime(value: unknown): unknown {
  if (typeof value !== "string") return uncastable;
  // The stored form, read with one Date (#91); other text, such as a day that doesn't exist, gets
  // the checks below.
  const stored = isoStringForm.test(value) ? dateIfOnCalendar(value) : undefined;
  if (stored !== undefined) return stored;
  // A far year has no other form.
  if (expandedYearDateTime.test(value)) return dateIfCanonical(value) ?? uncastable;
  return castDatetime(zonelessDateTime.test(value) ? `${value}Z` : value);
}

/**
 * Text in the stored form as a `Date`, if it names a moment on the calendar. `value` must match
 * `isoStringForm`, which fixes where the month and day are. Every character is then a digit or a
 * fixed separator, so only the calendar can be wrong, and `Date` rolls a day that
 * doesn't exist over (`2026-02-30` to 2 March, `T24:00` to the next day): a date whose day or
 * month isn't the text's is refused. Cheaper than writing the text back to compare (#216).
 */
function dateIfOnCalendar(value: string): Date | undefined {
  const date = new Date(value);
  const month = Number(value.slice(5, 7));
  const day = Number(value.slice(8, 10));
  return date.getUTCDate() === day && date.getUTCMonth() + 1 === month ? date : undefined;
}

/**
 * `value` as a `Date`, if `toISOString` writes exactly this text for it. That also refuses a day
 * that doesn't exist, and a year written with more digits than it needs (`+002026`).
 */
function dateIfCanonical(value: string): Date | undefined {
  const date = new Date(value);
  return !isInvalidDate(date) && date.toISOString() === value ? date : undefined;
}

/** `1` and `0` are the stored form of a boolean; any other cell isn't one. */
function readBoolean(value: unknown): unknown {
  if (value === 1) return true;
  return value === 0 ? false : uncastable;
}

/** A valid `Date`, or an ISO-8601 string (a date, or a date and time with its offset). */
function castDatetime(value: unknown): unknown {
  if (value instanceof Date) return isInvalidDate(value) ? uncastable : value;
  if (typeof value !== "string") return uncastable;
  if (isoDate.test(value)) return dayOf(value) ?? uncastable;
  // The day must exist too: `Date` rolls 2026-02-30T10:00Z over to 2 March.
  if (!isoDateTime.test(value) || dayOf(value.slice(0, 10)) === undefined) return uncastable;
  const date = new Date(value.replace(" ", "T"));
  return isInvalidDate(date) ? uncastable : date;
}

/** `date`, or `uncastable` for an invalid one (a stored number past the range of a `Date`). */
function validDate(date: Date): Date | typeof uncastable {
  return isInvalidDate(date) ? uncastable : date;
}

/** Midnight UTC on `day` (`2026-01-02`), if that day exists. */
function dayOf(day: string): Date | undefined {
  const date = new Date(`${day}T00:00:00.000Z`);
  return !isInvalidDate(date) && date.toISOString().startsWith(day) ? date : undefined;
}

export function isInvalidDate(value: unknown): boolean {
  return value instanceof Date && Number.isNaN(value.getTime());
}
