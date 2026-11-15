// Date and time attributes' values (#391): a day as `"2026-01-02"` and a time of day as `"14:30:00"`, text with no zone, from what an app assigns and what each database returns.
import { uncastable } from "./conversion.ts";

/** A day: a four-digit year, a month and a day. */
const dayText = /^(\d{4})-(\d{2})-(\d{2})$/;

/**
 * Text naming a day that exists (`"2026-01-02"`), as it is; anything else, a `Date` included
 * (its day depends on the time zone), is `uncastable`. Each database returns a day as this text.
 */
export function castDay(value: unknown): unknown {
  if (typeof value !== "string") return uncastable;
  const match = dayText.exec(value);
  if (match === null) return uncastable;
  const [, year, month, day] = match.map(Number) as [number, number, number, number];
  const date = new Date(0);
  date.setUTCFullYear(year, month - 1, day);
  const exists = date.getUTCMonth() === month - 1 && date.getUTCDate() === day;
  return exists ? value : uncastable;
}
