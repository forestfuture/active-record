// A json value's JSON text, refusing a `column()`, typed value or `incoming()` nested in it, with its path (#547).
import { isAttributeReference, refuseReferenceValue } from "./sql.ts";

/** Thrown by `jsonText` for a fragment's reference found inside a json value, at `path` from its top. */
export class NestedReferenceFound extends Error {
  readonly path: string;
  readonly reference: unknown;

  constructor(path: string, reference: unknown) {
    super(`a reference at ${path}`);
    this.path = path;
    this.reference = reference;
  }

  /** The reference's path under the attribute `name`: `settings.a.0`. */
  pathUnder(name: string): string {
    return this.path === "" ? name : `${name}.${this.path}`;
  }
}

/**
 * A json value's JSON text, or undefined where JSON gives none. A `column()`, typed value or
 * `incoming()` anywhere in it throws `NestedReferenceFound`, rather than being written as its
 * fields. The check is part of the `stringify` that writes the value, so it costs no walk of its own.
 */
export function jsonText(value: unknown): string | undefined {
  const paths = new WeakMap<object, string>();
  return JSON.stringify(value, function (this: object, key: string, inner: unknown) {
    const parent = paths.get(this);
    const path = parent === undefined ? "" : parent === "" ? key : `${parent}.${key}`;
    if (isAttributeReference(inner)) throw new NestedReferenceFound(path, inner);
    if (typeof inner === "object" && inner !== null) paths.set(inner, path);
    return inner;
  });
}

/**
 * Throws `TypeError` for a fragment's reference nested in a condition's json value, as
 * `refuseReferenceValue` does for one given as the value itself.
 */
export function refuseNestedReference(value: unknown, gives: string): void {
  try {
    jsonText(value);
  } catch (error) {
    if (error instanceof NestedReferenceFound) {
      refuseReferenceValue(error.reference, error.pathUnder(gives));
    }
  }
}
