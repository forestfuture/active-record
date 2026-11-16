// A generated decimal's precision and scale (#398), from a column's size, kept only when a `NUMERIC(p, s)` could have them.
import { digitsProblem } from "../../src/decimal-values.ts";
import type { Spec } from "../adapter.ts";

/**
 * `spec` with a decimal's precision and scale, as a column's type gives them: neither when the
 * column has no precision, and the scale only when it's given. Digits no `NUMERIC(p, s)` has (a
 * precision past 1000, a scale past the precision) leave both off, so the Model stays valid.
 */
export function withDigits(spec: Spec, precision?: number | null, scale?: number | null): Spec {
  if (spec.type !== "decimal" || precision === undefined || precision === null) return spec;
  const digits = { precision, ...(scale !== undefined && scale !== null && { scale }) };
  return digitsProblem(digits) === undefined ? { ...spec, ...digits } : spec;
}
