// The `comparison` validator (#342): a value against bounds given as values, and the order checks it shares with `numericality`.
import type { Failure } from "./errors-collection.ts";

/** What `comparison` compares: numbers with numbers, strings with strings, Dates by their time. */
export type Comparable = number | string | Date;

/** The bounds of a `comparison` rule, with Rails' error types as keys. */
export interface ComparisonOptions {
  greaterThan?: Comparable;
  greaterThanOrEqualTo?: Comparable;
  lessThan?: Comparable;
  lessThanOrEqualTo?: Comparable;
  equalTo?: Comparable;
  otherThan?: Comparable;
}

type Order = -1 | 0 | 1;

/** The bounds `numericality` shares: error type, and whether the value's order meets it. */
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

/** Where `a` falls against `b`: Dates by their time, numbers and strings as `<` orders them. */
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

/** The failures of `value` against each bound of `rule`, in the order of `ORDER_CHECKS`. */
export function comparisonFailures(value: unknown, rule: ComparisonOptions): Failure[] {
  return ORDER_CHECKS.flatMap(([type, holds]) => {
    const bound = rule[type];
    if (bound === undefined || holds(orderOf(value as Comparable, bound))) return [];
    return [{ type, values: { count: shown(bound) } }];
  });
}
