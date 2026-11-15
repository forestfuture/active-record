// An enum attribute's values (#340): its names, the value each is stored as, and validating them.
import { UnknownAttribute } from "./errors.ts";
import type { AttributeDefinition } from "./metadata.ts";
import type { Validation } from "./validations.ts";

/**
 * An enum's values: its names, each stored as itself (a `string` attribute's only), or each name
 * with the value it's stored as (`{ draft: 0, published: 1 }`).
 */
export type EnumValues = readonly string[] | { readonly [name: string]: string | number };

/** A `string` attribute's enum: names stored as themselves, or each with the text it's stored as. */
export type TextEnum = readonly string[] | { readonly [name: string]: string };

/** An `integer` attribute's enum: each name with the integer it's stored as. */
export type IntegerEnum = { readonly [name: string]: number };

/** The names an enum's values give its attribute: `"draft" | "published"`. */
export type EnumNames<E> = E extends readonly (infer N extends string)[] ? N : keyof E & string;

/** Whether `value` is an enum's values: a list of names, or an object of names and stored values. */
export function isEnumValues(value: unknown): value is EnumValues {
  if (Array.isArray(value)) return value.every((name) => typeof name === "string");
  if (typeof value !== "object" || value === null) return false;
  return Object.values(value).every((each) => typeof each === "string" || typeof each === "number");
}

/** Each name with the value it's stored as, in declaration order. */
export function enumEntries(values: EnumValues): [string, string | number][] {
  return Array.isArray(values)
    ? values.map((name: string) => [name, name])
    : Object.entries(values as Record<string, string | number>);
}

/** The names as a message lists them: `"draft", "published"`. */
export function listedNames(values: EnumValues): string {
  return enumEntries(values)
    .map(([name]) => JSON.stringify(name))
    .join(", ");
}

/**
 * What's wrong with `values` as the enum of an attribute of `type`, as the words that follow the
 * attribute's name (`is "integer", so …`), or undefined. Past the types, so it checks the shape too.
 */
export function enumProblem(values: unknown, type: string): string | undefined {
  if (!isEnumValues(values)) {
    return ` has an enum ${JSON.stringify(values)}; give it a list of names, or an object of names and the values they're stored as`;
  }
  if (Array.isArray(values) && type !== "string") {
    return ` is "${type}", so its enum gives each name the integer it's stored as, not a list of names`;
  }
  const entries = enumEntries(values);
  if (entries.length === 0) return " has an enum with no names; give it at least one";
  return storedTypeProblem(entries, type) ?? repeatProblem(entries);
}

/** A stored value that isn't of the attribute's type: text for a string, a safe integer for an integer. */
function storedTypeProblem(
  entries: readonly [string, string | number][],
  type: string,
): string | undefined {
  const fits = type === "string" ? isText : Number.isSafeInteger;
  const wrong = entries.find(([, stored]) => !fits(stored));
  if (wrong === undefined) return undefined;
  const kind = type === "string" ? "text" : "integers";
  return ` is "${type}", so its enum stores ${kind}, not ${JSON.stringify(wrong[1])} for "${wrong[0]}"`;
}

const isText = (value: unknown): boolean => typeof value === "string";

/** A name given twice, or a value two names are stored as: a stored cell would read as either. */
function repeatProblem(entries: readonly [string, string | number][]): string | undefined {
  const names = new Set<string>();
  const stored = new Map<string | number, string>();
  for (const [name, value] of entries) {
    if (names.has(name)) return `'s enum names "${name}" twice`;
    const other = stored.get(value);
    if (other !== undefined) {
      return `'s enum stores ${JSON.stringify(value)} for both "${other}" and "${name}"`;
    }
    names.add(name);
    stored.set(value, name);
  }
  return undefined;
}

/**
 * The validations an enum declared `validate: true` adds, before a Model's own: its value must be
 * one of its names, and not null unless `allowNull`, as Rails' `validate: true` adds them.
 */
export function enumValidations(
  definitions: ReadonlyMap<string, AttributeDefinition>,
): Validation[] {
  return [...definitions].flatMap(([attribute, { enum: values, validate = false }]) => {
    if (values === undefined || validate === false) return [];
    const allowNull = validate !== true && validate.allowNull === true;
    const names = enumEntries(values).map(([name]) => name);
    return [{ attribute, options: { inclusion: names, allowNull } }];
  });
}

/** An enum's names, each with the value it's stored as, as `enumValues` gives them. */
export type EnumMapping<E> = E extends readonly string[]
  ? { readonly [N in E[number]]: N }
  : Readonly<E>;

/** Each enum's mapping, made once: `enumValues` gives the same frozen object each time. */
const mappings = new WeakMap<EnumValues, Readonly<Record<string, string | number>>>();

/** An enum's names and the value each is stored as, frozen: `{ draft: "draft" }`, `{ low: 0 }`. */
function mappingOf(values: EnumValues): Readonly<Record<string, string | number>> {
  let mapping = mappings.get(values);
  if (mapping === undefined) {
    mapping = Object.freeze(Object.fromEntries(enumEntries(values)));
    mappings.set(values, mapping);
  }
  return mapping;
}

/** `model`'s enum `attribute`'s mapping, or `UnknownAttribute` for a name that isn't an enum's. */
export function enumValuesOf(
  model: {
    readonly name: string;
    readonly attributeDefinitions: ReadonlyMap<string, AttributeDefinition>;
  },
  attribute: string,
): Readonly<Record<string, string | number>> {
  const values = model.attributeDefinitions.get(attribute)?.enum;
  if (values === undefined) {
    throw new UnknownAttribute(`${model.name} has no enum attribute "${attribute}"`);
  }
  return mappingOf(values);
}
