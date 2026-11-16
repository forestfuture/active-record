// A decimal attribute's values (#391): exact numbers as text in one canonical form (`"12.5"`), from what an app assigns and what each database returns.
import { uncastable } from "./conversion.ts";

/**
 * A decimal number: a sign, digits with an optional point (`1.5`, `5.`, `.5`), an optional
 * exponent, and spaces around it. Digits after the point only follow a point, so no run of digits
 * can match two ways (ReDoS).
 */
const decimalText = /^\s*([+-]?)(?:(\d+)(?:\.(\d*))?|\.(\d+))(?:e([+-]?\d+))?\s*$/i;

/** The most digits Postgres's `numeric` holds before its point, and after it. */
const maxWholeDigits = 131072;
const maxFractionDigits = 16383;

/**
 * The longest text that can be a decimal: every digit Postgres holds, with room for a sign, a
 * point, an exponent and spaces. Longer text is refused before it's read.
 */
const maxTextLength = maxWholeDigits + maxFractionDigits + 64;

/** A number's significant digits when it's cast, as Rails casts a float to a decimal. */
const numberPrecision = 16;

/**
 * An assigned value as a decimal's text: decimal text or a `bigint` as it is, a finite number at
 * 16 significant digits (`0.1 + 0.2` is `"0.3"`); anything else, or a number past what
 * Postgres's `numeric` holds, is `uncastable`.
 */
export function castDecimal(value: unknown): unknown {
  if (typeof value === "bigint") return canonical(String(value));
  if (typeof value === "number") return castNumber(value);
  return typeof value === "string" ? canonical(value) : uncastable;
}

/**
 * A stored cell as a decimal's text. Postgres returns `numeric` as text; D1 returns a `DECIMAL`
 * cell as a number, since SQLite keeps decimal text as a REAL or an INTEGER, so it reads at 16
 * significant digits, a whole number past a safe integer too, as Rails reads one on SQLite.
 */
export function readDecimal(cell: unknown): unknown {
  if (typeof cell === "number") return castNumber(cell);
  return typeof cell === "string" ? canonical(cell) : uncastable;
}

function castNumber(value: number): unknown {
  if (!Number.isFinite(value)) return uncastable;
  const decimal = canonical(value.toPrecision(numberPrecision));
  // At the top of a double's range, 16 digits round past it; 17 hold any double exactly.
  return decimal === uncastable ? canonical(value.toPrecision(numberPrecision + 1)) : decimal;
}

/**
 * Decimal text in its one form: no exponent, no `+`, no leading zeros but one before the point,
 * no trailing zeros after it, and `"0"` for any zero; `uncastable` for anything else.
 */
function canonical(text: string): unknown {
  const parts = partsOf(text);
  if (parts === undefined) return uncastable;
  const { negative, digits, point } = parts;
  const first = digits.search(/[1-9]/);
  if (first === -1) return "0";
  const last = lastNonZero(digits) + 1;
  if (point - first > maxWholeDigits || last - point > maxFractionDigits) return uncastable;
  const decimal = (negative ? "-" : "") + placePoint(digits.slice(first, last), point - first);
  return isWithinDouble(decimal) ? decimal : uncastable;
}

/**
 * Whether a double holds a non-zero decimal's magnitude: it doesn't overflow to Infinity or
 * underflow to 0. D1 keeps a decimal as a double, and stores one past either end as Infinity,
 * which reads as NULL, or as 0, so every database refuses one alike (#391).
 */
function isWithinDouble(decimal: string): boolean {
  const number = Number(decimal);
  return Number.isFinite(number) && number !== 0;
}

/** Decimal text's sign, its digits, and how many of them its point follows; undefined if it isn't one. */
function partsOf(text: string): { negative: boolean; digits: string; point: number } | undefined {
  if (text.length > maxTextLength) return undefined;
  const match = decimalText.exec(text);
  if (match === null) return undefined;
  const [, sign, whole = "", pointed, unpointed, exponent = "0"] = match;
  const fraction = pointed ?? unpointed ?? "";
  return {
    negative: sign === "-",
    digits: whole + fraction,
    point: whole.length + Number(exponent),
  };
}

/**
 * Where `digits`' last non-zero digit is, found by a loop: `/0*$/` tries every place in turn, so
 * on a long run of zeros it takes quadratic time.
 */
function lastNonZero(digits: string): number {
  let index = digits.length - 1;
  while (digits[index] === "0") index--;
  return index;
}

/** Significant `digits` with the point `point` digits after the first, padded with zeros. */
function placePoint(digits: string, point: number): string {
  if (point <= 0) return `0.${"0".repeat(-point)}${digits}`;
  if (point >= digits.length) return digits + "0".repeat(point - digits.length);
  return `${digits.slice(0, point)}.${digits.slice(point)}`;
}

/**
 * Where decimal `a` falls against decimal `b`, both in their one form: -1, 0 or 1. By sign, then
 * by the digits before the point (more is larger), then digit by digit, which is exact.
 */
function compareDecimals(a: string, b: string): number {
  const [signA, signB] = [signOf(a), signOf(b)];
  if (signA !== signB) return Math.sign(signA - signB);
  const order = compareMagnitudes(a.replace("-", ""), b.replace("-", ""));
  return signA < 0 ? -order : order;
}

function signOf(decimal: string): number {
  if (decimal === "0") return 0;
  return decimal.startsWith("-") ? -1 : 1;
}

function compareMagnitudes(a: string, b: string): number {
  const [wholeA = "", fractionA = ""] = a.split(".");
  const [wholeB = "", fractionB = ""] = b.split(".");
  if (wholeA.length !== wholeB.length) return Math.sign(wholeA.length - wholeB.length);
  const width = Math.max(fractionA.length, fractionB.length);
  const [left, right] = [
    wholeA + fractionA.padEnd(width, "0"),
    wholeB + fractionB.padEnd(width, "0"),
  ];
  if (left === right) return 0;
  return left < right ? -1 : 1;
}

/**
 * Where a decimal falls against a bound given as a number or decimal text: exactly, as
 * `compareDecimals` does. A bound of `NaN` orders against nothing (NaN), and `±Infinity` beyond
 * every decimal; `undefined` for a bound that isn't a number (text that isn't a decimal).
 */
export function orderDecimal(value: string, bound: number | string): number | undefined {
  if (typeof bound === "number" && !Number.isFinite(bound)) {
    return Number.isNaN(bound) ? Number.NaN : -Math.sign(bound);
  }
  const decimal = castDecimal(bound);
  return decimal === uncastable ? undefined : compareDecimals(value, decimal as string);
}

/** A decimal's precision and scale, as `NUMERIC(10, 2)` gives them (#398). */
export interface DecimalLimits {
  precision?: number;
  scale?: number;
}

/**
 * A decimal in its one form, rounded to its scale, half away from zero, as Postgres's `numeric`
 * and Rails round; `uncastable` when its digits before the point are more than the precision
 * leaves them. A precision without a scale has a scale of 0, as SQL's `NUMERIC(10)` does.
 */
export function limitDecimal(decimal: string, { precision, scale }: DecimalLimits): unknown {
  const places = scale ?? (precision === undefined ? undefined : 0);
  const rounded = places === undefined ? decimal : roundDecimal(decimal, places);
  if (precision === undefined) return rounded;
  const whole = rounded.replace("-", "").split(".")[0]!;
  const wholeDigits = whole === "0" ? 0 : whole.length;
  return wholeDigits > precision - (places ?? 0) ? uncastable : rounded;
}

/** A decimal in its one form, rounded to `places` digits after the point, half away from zero. */
function roundDecimal(decimal: string, places: number): string {
  const negative = decimal.startsWith("-");
  const [whole = "", fraction = ""] = decimal.replace("-", "").split(".");
  if (fraction.length <= places) return decimal;
  const kept = whole + fraction.slice(0, places);
  const digits = fraction[places]! >= "5" ? incremented(kept) : kept;
  const point = digits.length - places;
  const result = canonical(`${digits.slice(0, point)}.${digits.slice(point)}`) as string;
  return negative && result !== "0" ? `-${result}` : result;
}

/** A run of digits plus one in its last place: `"199"` → `"200"`, `"99"` → `"100"`. */
function incremented(digits: string): string {
  let index = digits.length - 1;
  while (index >= 0 && digits[index] === "9") index--;
  const head = index < 0 ? "1" : digits.slice(0, index) + String(Number(digits[index]) + 1);
  return head + "0".repeat(digits.length - 1 - index);
}
