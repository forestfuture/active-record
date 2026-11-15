// A generated enum's spec: the names the database restricts a string column to, with its methods off until the Model's override turns them on (#64, ADR-0021); and those names read from a CHECK's list.
import type { Spec } from "../adapter.ts";

/** A string spec with the names its column is restricted to, as a generated enum; any other spec as it is. */
export function withGeneratedEnum(spec: Spec, names: readonly string[] | undefined): Spec {
  if (names === undefined || spec.type !== "string") return spec;
  return { ...spec, enum: names, scopes: false, instanceMethods: false };
}

/** A CHECK's list of SQL string literals as their text, each once: `'a', 'it''s', 'a'` → `["a", "it's"]`. */
export function listedNames(list: string): string[] {
  const texts = [...list.matchAll(/'((?:[^']|'')*)'/g)].map((match) => match[1]!);
  return [...new Set(texts.map((text) => text.replaceAll("''", "'")))];
}
