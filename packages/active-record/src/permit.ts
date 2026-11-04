// `permit`: keeps only the named attributes from untrusted input, each cast to its type (#82).
import { attributeFor } from "./attribute.ts";
import { attributeOf } from "./metadata.ts";
import type { AttributesOf, ModelClass } from "./model.ts";

/** What `permit` returns: the named attributes, each optional, as their types. */
export type Permitted<C extends ModelClass, K extends string> = Partial<
  Pick<AttributesOf<InstanceType<C>>, K & keyof AttributesOf<InstanceType<C>>>
>;

/**
 * The named attributes of untrusted `input`, as Rails' `params.permit`: every other key is
 * dropped, so it never reaches a record (#82). Each value is cast as assigning it would be
 * (#81), so the result is what its type says even before it's assigned.
 */
export function permitted(
  model: ModelClass,
  input: unknown,
  names: readonly string[],
): Record<string, unknown> {
  for (const name of names) attributeOf(model, name);
  const given = givenValues(model, input);
  return Object.fromEntries(
    names
      .filter((name) => given.has(name))
      .map((name) => [name, castPermitted(model, name, given.get(name))]),
  );
}

/** A permitted value, cast; a file (from a form) is refused, since no attribute stores one. */
function castPermitted(model: ModelClass, name: string, value: unknown): unknown {
  if (value instanceof Blob) {
    throw new TypeError(`${model.name}: "${name}" is a file, and no attribute stores one`);
  }
  return attributeFor(model, name).cast(value);
}

/**
 * Each key of `input` and its value: a plain object's own keys, so `__proto__` never counts,
 * or a form's or query string's, where a repeated key takes its last value.
 */
function givenValues(model: ModelClass, input: unknown): Map<string, unknown> {
  if (input instanceof FormData || input instanceof URLSearchParams) {
    return new Map<string, unknown>(input);
  }
  if (!isPlainObject(input)) {
    throw new TypeError(`${model.name}.permit() takes an object, FormData or URLSearchParams`);
  }
  return new Map(Object.entries(input));
}

/** An object literal or parsed JSON: not an array, a `Map`, a `Date` or a class's instance. */
function isPlainObject(input: unknown): input is object {
  if (typeof input !== "object" || input === null) return false;
  const prototype: unknown = Object.getPrototypeOf(input);
  return prototype === Object.prototype || prototype === null;
}
