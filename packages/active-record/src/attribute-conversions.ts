// An attribute's conversions as a value (#148): the cast, write and read d1-record does for it,
// for SQL d1-record doesn't write (a raw D1 statement, a cache key, a row checked in a test).
// Not the declared type (`"datetime"`): that's an AttributeType, in metadata.ts.
import { attributeFor } from "./attribute.ts";
import type { ModelClass } from "./model.ts";

/**
 * What d1-record does with an attribute's values, by the attribute's type (and `storage`).
 * `T` is the attribute's JavaScript type. Each is a function of its own, so one can be passed
 * on or destructured.
 */
export interface AttributeConversions<T> {
  /**
   * `input` as the attribute's JavaScript value, as assigning it would: strict, so `TypeError`
   * naming the Model and attribute when it can't be. `null` stays `null`; `undefined` throws.
   * Nothing is floored: a `Date` with milliseconds keeps them, whatever the attribute's `storage`.
   */
  readonly cast: (input: unknown) => T;
  /**
   * `input`, cast, as D1 stores it: an ISO string, an integer for a `storage` attribute (seconds
   * are floored), `0` or `1`, JSON text. The value `column(attribute).value(input)` binds inside
   * an `sql` fragment; `undefined` throws as assigning it does.
   */
  readonly serialize: (input: unknown) => string | number | null;
  /**
   * A cell D1 returned, as the attribute's JavaScript value; `null` for NULL and `undefined`.
   * It reads as a record load does, so a cell that can't be read throws `TypeError` naming the
   * Model and attribute: text in a Unix time column, a number past the range of a `Date`, or text
   * in a `json` column that isn't JSON.
   */
  readonly deserialize: (stored: unknown) => T;
}

/** The conversions of `model`'s `attribute`; `UnknownAttribute` if it has none by that name. */
export function conversionsFor<T>(model: ModelClass, attribute: string): AttributeConversions<T> {
  const resolved = attributeFor(model, attribute);
  return Object.freeze({
    cast: (input: unknown) => resolved.cast(input) as T,
    serialize: (input: unknown) => resolved.store(input) as string | number | null,
    deserialize: (stored: unknown) => resolved.read(stored) as T,
  });
}
