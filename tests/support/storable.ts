// Generated values the conformance suite's adapter can store: none holding a NUL on one whose text can't (nul-in-text).
import type fc from "fast-check";
import { isAllowed } from "../conformance/allowed-differences.ts";
import { providedAdapter } from "./harness.ts";

/** Whether `value` holds a NUL anywhere: in a string, or an array's or object's keys or values. */
function hasNul(value: unknown, seen = new Set<unknown>()): boolean {
  if (typeof value === "string") return value.includes("\u0000");
  if (typeof value !== "object" || value === null || seen.has(value)) return false;
  seen.add(value);
  return Reflect.ownKeys(value).some(
    (key) =>
      (typeof key === "string" && key.includes("\u0000")) ||
      hasNul((value as Record<PropertyKey, unknown>)[key], seen),
  );
}

/** `values`, without those holding a NUL where the adapter refuses one. */
export function storable<T>(values: fc.Arbitrary<T>): fc.Arbitrary<T> {
  if (!isAllowed(providedAdapter(), "nul-in-text")) return values;
  return values.filter((value) => !hasNul(value));
}
