// The `comparison` validator (#342): a value against bounds given as values or functions of the record, and the order checks it shares with `numericality`.
import { withArticle } from "./attribute.ts";
import { isBlank } from "./blank.ts";
import { orderDecimal } from "./decimal-values.ts";
import { FILTERED } from "./filtering.ts";
import type { Failure } from "./errors-collection.ts";
import type { ValidationSubject } from "./validations.ts";

/** What `comparison` compares: numbers with numbers, strings with strings, Dates by their time. */
export type Comparable = number | string | Date;

/** A bound: a value, or a function of the record being validated (`(event) => event.startsAt`). */
export type ComparisonBound<R = never> = Comparable | ((record: R) => Comparable | null);

/** The bounds of a `comparison` rule, with its error types as keys. `R` is the record type. */
export interface ComparisonOptions<R = never> {
  greaterThan?: ComparisonBound<R>;
  greaterThanOrEqualTo?: ComparisonBound<R>;
  lessThan?: ComparisonBound<R>;
  lessThanOrEqualTo?: ComparisonBound<R>;
  equalTo?: ComparisonBound<R>;
  otherThan?: ComparisonBound<R>;
}

/** -1, 0 or 1; NaN when the two don't order (NaN, or an invalid Date), so only `otherThan` holds. */
type Order = number;

/** @internal The bounds `numericality` shares: error type, and whether the value's order meets it. */
export const RANGE_CHECKS = [
  ["greaterThan", (order: Order) => order > 0],
  ["greaterThanOrEqualTo", (order: Order) => order >= 0],
  ["lessThan", (order: Order) => order < 0],
  ["lessThanOrEqualTo", (order: Order) => order <= 0],
] as const;

const ORDER_CHECKS = [
  ...RANGE_CHECKS,
  ["equalTo", (order: Order) => order === 0],
  ["otherThan", (order: Order) => order !== 0],
] as const;

/** @internal Where `a` falls against `b`: Dates by their time, numbers and strings as `<` orders them. */
export function orderOf(a: Comparable, b: Comparable): Order {
  const left = a instanceof Date ? a.getTime() : a;
  const right = b instanceof Date ? b.getTime() : b;
  if (left < right) return -1;
  if (left > right) return 1;
  return left === right ? 0 : Number.NaN;
}

/** Whether `a` and `b` are the same value: of one kind, and equal as `equalTo` compares them. */
function isSame(a: unknown, b: Comparable): boolean {
  return kindOf(a) === kindOf(b) && orderOf(a as Comparable, b) === 0;
}

/** A bound as its message's `%{count}` shows it: a Date as an ISO string. */
function shown(bound: Comparable): string | number {
  if (!(bound instanceof Date)) return bound;
  return Number.isNaN(bound.getTime()) ? "Invalid Date" : bound.toISOString();
}

/** A function bound's result as `%{count}` shows it: `[FILTERED]` if a filtered attribute holds it. */
function shownFromRecord(bound: Comparable, subject: ValidationSubject): string | number {
  const isFilteredValue = subject.filteredValues().some((value) => isSame(value, bound));
  return isFilteredValue ? FILTERED : shown(bound);
}

/** The kinds of value `comparison` orders. */
const COMPARABLE_KINDS: ReadonlySet<string> = new Set(["number", "string", "Date"]);

/** A value's kind: `Date` for a Date, or its `typeof` (`number`, `boolean`, …). */
function kindOf(value: unknown): string {
  return value instanceof Date ? "Date" : typeof value;
}

/** Throws `TypeError` unless `value` and `bound` are both numbers, strings or Dates. */
function requireComparable(value: unknown, bound: unknown, subject: ValidationSubject): void {
  const [kind, boundKind] = [kindOf(value), kindOf(bound)];
  if (kind === boundKind && COMPARABLE_KINDS.has(kind)) return;
  throw incomparable(subject, withArticle(kind), withArticle(boundKind));
}

/** `Rota: "hours" (a number) can't be compared with a Date`. */
function incomparable(subject: ValidationSubject, value: string, bound: string): TypeError {
  const model = subject.record.constructor.name;
  return new TypeError(
    `${model}: "${subject.attribute}" (${value}) can't be compared with ${bound}`,
  );
}

/**
 * Where a value falls against a bound, throwing `TypeError` for two that can't be compared. A
 * decimal attribute's text compares exactly with a number or decimal text, as a number (#391).
 */
function orderAgainst(value: unknown, bound: Comparable, subject: ValidationSubject): Order {
  if (!(subject.isDecimal && typeof value === "string")) {
    requireComparable(value, bound, subject);
    return orderOf(value as Comparable, bound);
  }
  const order = bound instanceof Date ? undefined : orderDecimal(value, bound);
  if (order === undefined) {
    const described =
      typeof bound === "string" ? "a string that isn't a decimal" : withArticle(kindOf(bound));
    throw incomparable(subject, "a decimal", described);
  }
  return order;
}

/**
 * @internal The failures of a value against each bound of `rule`, in `ORDER_CHECKS`' order: `blank` once
 * for a blank value (null, or only whitespace), and none for a bound that's null.
 */
export function comparisonFailures(
  value: unknown,
  rule: ComparisonOptions<unknown>,
  subject: ValidationSubject,
): Failure[] {
  const bounds = ORDER_CHECKS.filter(([type]) => rule[type] !== undefined);
  if (isBlank(value)) return bounds.length === 0 ? [] : [{ type: "blank" }];
  return bounds.flatMap(([type, holds]) => {
    const given = rule[type];
    const fromRecord = typeof given === "function";
    const bound = fromRecord ? given(subject.record) : given;
    if (bound === null || bound === undefined) return [];
    return holds(orderAgainst(value, bound, subject))
      ? []
      : [{ type, values: { count: fromRecord ? shownFromRecord(bound, subject) : shown(bound) } }];
  });
}
