// Normalizations (#354): what `normalizes` declares, and the ones each attribute's assigned values go through.
import { declared } from "./declarations.ts";
import { InvalidModel } from "./errors.ts";

/**
 * What `normalizes` takes for an attribute whose values are `T`: a function given a value of
 * the attribute's type, once it's cast, returning the value to keep. It isn't given `null`
 * unless `applyToNull` is `true`.
 */
export type NormalizeOptions<T> =
  | { with: (value: NonNullable<T>) => T; applyToNull?: false }
  | { with: (value: T) => T; applyToNull: true };

/** One `normalizes` declaration. */
export interface Normalization {
  attribute: string;
  with: (value: unknown) => unknown;
  applyToNull: boolean;
}

/** The normalizations declared for one of `model`'s attributes, a parent class's first. */
export function normalizationsOf(model: object, attribute: string): Normalization[] {
  return declared(model, "normalizations").filter((each) => each.attribute === attribute);
}

/** Refuses a normalization of a name that isn't one of `model`'s attributes. */
export function checkNormalizedName(
  model: { readonly name: string; readonly attributeDefinitions: ReadonlyMap<string, unknown> },
  attribute: string,
): void {
  if (model.attributeDefinitions.has(attribute)) return;
  throw new InvalidModel(
    `${model.name} normalizes "${attribute}", which isn't one of its attributes`,
  );
}
