// Custom attribute types (#20): `defineType`, for a value no built-in type holds, kept in its column as a built-in type's value (ADR-0022).
import type { AttributeType, ValueOfType } from "./metadata.ts";
import { attributeTypeNames, isAttributeType } from "./spec-keys.ts";

/**
 * A type an app defines: what its values are, and how each is kept as a value of the built-in
 * type it's stored as. Made by `defineType`.
 */
export interface CustomType<T = unknown, S extends AttributeType = AttributeType> {
  /** The built-in type its values are stored as: `"integer"` for money kept as cents. */
  readonly storedAs: S;
  /**
   * An assigned value or a condition's as the type's value. It throws for one it can't hold:
   * assigning that value throws `TypeError`, with this error as its `cause`, and a condition
   * matches nothing. Never called with `null`.
   */
  cast(input: unknown): T;
  /** A value as the stored type's value: `money.cents`. Never called with `null`. */
  serialize(value: T): ValueOfType<S>;
  /** A stored type's value, read as the stored type reads a cell, as the type's value. */
  deserialize(stored: ValueOfType<S>): T;
}

/** Any custom type, whatever its values: what a spec takes. */
// oxlint-disable-next-line typescript/no-explicit-any -- a spec holds custom types of any value; `unknown` would refuse each one's own cast and serialize
export type AnyCustomType = CustomType<any, AttributeType>;

/** Every type `defineType` made, so a spec can't pass off another object as one. */
const defined = new WeakSet<object>();

/**
 * Defines an attribute type, used in a spec as a type name is: `price: money`, or
 * `{ type: money, null: false }`. Its values are kept as `storedAs` keeps its own, so they're
 * read strictly, compared and ordered as that type's are.
 */
export function defineType<T, S extends AttributeType>(type: CustomType<T, S>): CustomType<T, S> {
  requireWellFormed(type);
  // Each is called on `type`, so a type written as a class keeps its `this`.
  const made: CustomType<T, S> = Object.freeze({
    storedAs: type.storedAs,
    cast: (input: unknown) => type.cast(input),
    serialize: (value: T) => type.serialize(value),
    deserialize: (stored: ValueOfType<S>) => type.deserialize(stored),
  });
  defined.add(made);
  return made;
}

/** The functions a type needs, each checked when it's made. */
const functionNames = ["cast", "serialize", "deserialize"] as const;

/**
 * Throws `TypeError` for a type that couldn't work, past the types (plain JavaScript, or a cast):
 * a `storedAs` that isn't a built-in type's name, or a function it lacks.
 */
function requireWellFormed(type: CustomType<unknown, AttributeType>): void {
  if (!isAttributeType(type.storedAs)) {
    throw new TypeError(
      `defineType: storedAs ${JSON.stringify(type.storedAs)} isn't a type's name; use ${attributeTypeNames}`,
    );
  }
  const missing = functionNames.find((name) => typeof type[name] !== "function");
  if (missing !== undefined) throw new TypeError(`defineType: ${missing} isn't a function`);
}

/** Whether `value` is a type `defineType` made. */
export function isCustomType(value: unknown): value is AnyCustomType {
  return typeof value === "object" && value !== null && defined.has(value);
}
