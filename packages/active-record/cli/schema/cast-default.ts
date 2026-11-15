// A column's literal default as a decimal, a date or a time holds it (#391): cast as an assigned value is, so it's in the type's one form.
import { castValue, uncastable } from "../../src/conversion.ts";
import type { Default } from "../adapter.ts";

/** The attribute types whose literal default is cast as an assigned value is. */
export type CastDefaultType = "decimal" | "date" | "time";

/**
 * A literal default's text as the attribute's value (`1.50` → `"1.5"`, `'09:30'` → `"09:30:00"`),
 * or undefined for text the type can't hold, whose default then stays with the database.
 */
export function castDefault(type: CastDefaultType, text: string): Default | undefined {
  const value = castValue({ type }, text);
  return value === uncastable ? undefined : { literal: value };
}
