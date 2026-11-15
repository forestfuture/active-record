// A generated enum's spec: the names the database restricts a string column to, with its methods off until the Model's override turns them on (#64, ADR-0021).
import type { Spec } from "../adapter.ts";

/** A string spec with the names its column is restricted to, as a generated enum; any other spec as it is. */
export function withGeneratedEnum(spec: Spec, names: readonly string[] | null | undefined): Spec {
  if (names === undefined || names === null || spec.type !== "string") return spec;
  return { ...spec, enum: names, scopes: false, instanceMethods: false };
}
