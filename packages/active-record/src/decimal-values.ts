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
 * cell as a number, since SQLite keeps decimal text as a REAL or an INTEGER. An integer past a
 * safe one has already lost its digits, so it's `uncastable`.
 */
export function readDecimal(cell: unknown): unknown {
  if (typeof cell === "number") {
    return Number.isInteger(cell) && !Number.isSafeInteger(cell) ? uncastable : castNumber(cell);
  }
  return typeof cell === "string" ? canonical(cell) : uncastable;
}

function castNumber(value: number): unknown {
  return Number.isFinite(value) ? canonical(value.toPrecision(numberPrecision)) : uncastable;
}

/**
 * Decimal text in its one form: no exponent, no `+`, no leading zeros but one before the point,
 * no trailing zeros after it, and `"0"` for any zero; `uncastable` for anything else.
 */
function canonical(text: string): unknown {
  const match = decimalText.exec(text);
  if (match === null) return uncastable;
  const [, sign, whole = "", pointed, unpointed, exponent = "0"] = match;
  const fraction = pointed ?? unpointed ?? "";
  const digits = whole + fraction;
  const point = whole.length + Number(exponent);
  const first = digits.search(/[1-9]/);
  if (first === -1) return "0";
  const last = digits.length - /0*$/.exec(digits)![0].length;
  if (point - first > maxWholeDigits || last - point > maxFractionDigits) return uncastable;
  return (sign === "-" ? "-" : "") + placePoint(digits.slice(first, last), point - first);
}

/** Significant `digits` with the point `point` digits after the first, padded with zeros. */
function placePoint(digits: string, point: number): string {
  if (point <= 0) return `0.${"0".repeat(-point)}${digits}`;
  if (point >= digits.length) return digits + "0".repeat(point - digits.length);
  return `${digits.slice(0, point)}.${digits.slice(point)}`;
}
