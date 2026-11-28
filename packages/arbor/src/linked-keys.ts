// A key linked from another record's (#592): cast as the attribute it links to holds it, a datetime with storage linking as the integer it stores; and which kinds of key a link may mix (#596).
import { castKey, type Convertible, readValue, uncastable, writeValue } from "./conversion.ts";
import type { Attribute } from "./attribute.ts";

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

/** A link compares text, numbers of any stored type together, uuids, and every other type alone. */
type LinkKind =
  | "text"
  | "number"
  | Exclude<Attribute["storedType"], "string" | "integer" | "real" | "decimal">;

/** The kind of `attribute`'s values, by the type its column holds them as. */
function linkKindOf({ storedType }: Attribute): LinkKind {
  switch (storedType) {
    case "string":
      return "text";
    case "integer":
    case "real":
    case "decimal":
      return "number";
    default:
      return storedType;
  }
}

/** Whether `attribute` is one a mixed-type link may join to text: an integer or a uuid. */
const isMixable = ({ storedType }: Attribute) => storedType === "integer" || storedType === "uuid";

/**
 * Whether a link's two keys are of different kinds, text and an integer or a uuid (#596): the
 * only kinds a link may mix.
 */
export function isMixedType(key: Attribute, linked: Attribute): boolean {
  if (linkKindOf(key) === linkKindOf(linked)) return false;
  const [text, other] = key.storedType === "string" ? [key, linked] : [linked, key];
  return text.storedType === "string" && isMixable(other);
}
