// A key linked from another record's (#592): cast as the attribute it links to holds it, a datetime with storage linking as the integer it stores; and which kinds of key a link may mix (#596).
import { castKey, type Convertible, readValue, uncastable, writeValue } from "./conversion.ts";
import type { Attribute } from "./attribute.ts";

const integer: Convertible = { type: "integer" };

/**
 * `value`, a key of `from`, as `to` holds it, or `uncastable`. Keys stored alike are cast as a
 * condition's (#94), and text linked to an integer or a uuid only in its own text form (#596). Where one is a datetime kept as a Unix time and the other isn't kept the
 * same way, the link compares what they store, as a join does: a Unix time links as its
 * integer, and an integer links to a Unix time as the instant it stores.
 */
export function castLinked(to: Convertible, from: Convertible, value: unknown): unknown {
  if (!isOwnTextForm(to, from, value)) return uncastable;
  if (value === null || to.storage === from.storage) return castKey(to, value);
  const own = castKey(from, value);
  if (own === uncastable) return uncastable;
  const stored = from.storage === undefined ? own : writeValue(from, own);
  if (to.storage === undefined) return castKey(to, stored);
  const held = castKey(integer, stored);
  return held === uncastable ? uncastable : readValue(to, held);
}

/** An integer's own text: its digits, with no leading zero, and a minus sign for a negative. */
const integerText = /^(?:0|-?[1-9][0-9]*)$/;

/** A UUID's one text form, lowercase with hyphens, as a uuid attribute holds it (#588). */
const uuidText = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** The type a key's column holds it as: an integer for a datetime kept as a Unix time. */
const storedTypeOf = ({ type, storage }: Convertible) => (storage === undefined ? type : "integer");

/**
 * Whether `value`, a key of `from`, links to `to` as SQL compares a mixed-type link, as text
 * (#596): text links to an integer or a uuid only in that key's own text form, so `'09'` links
 * to no integer. Any other key links as it's cast.
 */
function isOwnTextForm(to: Convertible, from: Convertible, value: unknown): boolean {
  if (typeof value !== "string" || storedTypeOf(from) !== "string") return true;
  switch (storedTypeOf(to)) {
    case "integer":
      return integerText.test(value);
    case "uuid":
      return uuidText.test(value);
    default:
      return true;
  }
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

/**
 * Whether a link may join these two keys (#596): of one kind, or a mixed-type link. Any other
 * pair can't be compared alike on every database.
 */
export function isLinkable(key: Attribute, linked: Attribute): boolean {
  return linkKindOf(key) === linkKindOf(linked) || isMixedType(key, linked);
}
