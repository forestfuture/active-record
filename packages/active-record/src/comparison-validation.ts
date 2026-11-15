// The `comparison` validator (#342): a value against bounds given as values or functions of the record, and the order checks it shares with `numericality`.
import { withArticle } from "./attribute.ts";
import type { Failure } from "./errors-collection.ts";

/** What `comparison` compares: numbers with numbers, strings with strings, Dates by their time. */
export type Comparable = number | string | Date;

/** A bound: a value, or a function of the record being validated (`(event) => event.startsAt`). */
export type ComparisonBound<R = never> = Comparable | ((record: R) => Comparable | null);

/** The bounds of a `comparison` rule, with Rails' error types as keys. `R` is the record type. */
export interface ComparisonOptions<R = never> {
  greaterThan?: ComparisonBound<R>;
  greaterThanOrEqualTo?: ComparisonBound<R>;
  lessThan?: ComparisonBound<R>;
  lessThanOrEqualTo?: ComparisonBound<R>;
  equalTo?: ComparisonBound<R>;
  otherThan?: ComparisonBound<R>;
}

type Order = -1 | 0 | 1;

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
  return left > right ? 1 : 0;
}

/** A bound as its message shows it: a Date as an ISO string. */
function shown(bound: Comparable): string | number {
  return bound instanceof Date ? bound.toISOString() : bound;
}

/** What a value is called when it can't be compared: `a number`, `a Date`, `a boolean`. */
function kindOf(value: unknown): string {
  return withArticle(value instanceof Date ? "Date" : typeof value);
}

/** @internal The record being validated, and the attribute whose value is compared. */
export interface Compared {
  record: object;
  attribute: string;
}

/** Throws `TypeError` unless `value` and `bound` are both numbers, strings or Dates. */
function requireComparable(value: unknown, bound: unknown, { record, attribute }: Compared): void {
  const kind = kindOf(value);
  if (kind === kindOf(bound) && ["a number", "a string", "a Date"].includes(kind)) return;
  const model = record.constructor.name;
  throw new TypeError(`${model}: "${attribute}" (${kind}) can't be compared with ${kindOf(bound)}`);
}

/**
 * @internal The failures of a value against each bound of `rule`, in `ORDER_CHECKS`' order: `blank` once
 * for a null value, as Rails does, and none for a bound that's null.
 */
export function comparisonFailures(
  value: unknown,
  rule: ComparisonOptions<unknown>,
  compared: Compared,
): Failure[] {
  const bounds = ORDER_CHECKS.filter(([type]) => rule[type] !== undefined);
  if (value === null) return bounds.length === 0 ? [] : [{ type: "blank" }];
  return bounds.flatMap(([type, holds]) => {
    const given = rule[type];
    const bound = typeof given === "function" ? given(compared.record) : given;
    if (bound === null || bound === undefined) return [];
    requireComparable(value, bound, compared);
    return holds(orderOf(value as Comparable, bound))
      ? []
      : [{ type, values: { count: shown(bound) } }];
  });
}
