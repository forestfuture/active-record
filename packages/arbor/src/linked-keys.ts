// A key linked from another record's (#592): cast as the attribute it links to holds it, a datetime with storage linking as the integer it stores.
import { castKey, type Convertible, readValue, uncastable, writeValue } from "./conversion.ts";

const integer: Convertible = { type: "integer" };

/**
 * `value`, a key of `from`, as `to` holds it, or `uncastable`. Keys stored alike are cast as a
 * condition's (#94). Where one is a datetime kept as a Unix time and the other isn't kept the
 * same way, the link compares what they store, as a join does: a Unix time links as its
 * integer, and an integer links to a Unix time as the instant it stores.
 */
export function castLinked(to: Convertible, from: Convertible, value: unknown): unknown {
  if (value === null || to.storage === from.storage) return castKey(to, value);
  const own = castKey(from, value);
  if (own === uncastable) return uncastable;
  const stored = from.storage === undefined ? own : writeValue(from, own);
  if (to.storage === undefined) return castKey(to, stored);
  const held = castKey(integer, stored);
  return held === uncastable ? uncastable : readValue(to, held);
}
