// A column's literal default as a decimal, a date or a time holds it (#391): cast as an assigned value is, so it's in the type's one form.
import { castValue, uncastable } from "../../src/conversion.ts";

const castDefaultTypes = ["decimal", "date", "time"] as const;

/** The attribute types whose literal default is cast as an assigned value is. */
export type CastDefaultType = (typeof castDefaultTypes)[number];

/** Whether a type's literal default is cast as an assigned value is. */
export function isCastDefaultType(type: string): type is CastDefaultType {
  return (castDefaultTypes as readonly string[]).includes(type);
}

/**
 * A literal default's text as the attribute's value (`1.50` → `"1.5"`, `'09:30'` → `"09:30:00"`),
 * or undefined for text the type can't hold, whose default then stays with the database.
 */
export function castDefault(type: CastDefaultType, text: string): { literal: string } | undefined {
  const value = castValue({ type }, text);
  // Each of these types holds its values as text.
  return value === uncastable ? undefined : { literal: value as string };
}
