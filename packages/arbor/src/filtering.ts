// Filtered attributes: values hidden from `onQuery` listeners and error messages (#83).
import { attributeName } from "./attribute-aliases.ts";
import type { ModelClass } from "./model.ts";
import { underscore } from "./naming.ts";
import { secretAttributeNames } from "./secure-passwords.ts";

/** What a listener sees in place of a filtered attribute's value (#83). */
export const FILTERED = "[FILTERED]";

/**
 * An entry of `filterAttributes`: a string the attribute's snake_case name contains, lowercased
 * or read in snake_case (`"apiKey"` as `api_key`), or a RegExp the attribute or its snake_case
 * name matches.
 */
export type FilterAttribute = string | RegExp;

/**
 * The default filter list, of common secret and personal names: an attribute whose snake_case name
 * holds one of these, in any case, is filtered (`passwordDigest`, `apiKey`, `resetToken`, `email`).
 */
export const defaultFilterAttributes: readonly FilterAttribute[] = [
  "passw",
  "email",
  "secret",
  "token",
  "_key",
  "crypt",
  "salt",
  "certificate",
  "otp",
  "ssn",
  "cvv",
  "cvc",
];

/**
 * Whether an attribute's values are hidden from listeners: a secure password's or a secure
 * token's always (#355); any other when its snake_case name, or an alias's,
 * holds a string entry lowercased, or read in snake_case (`"apiKey"` as `api_key`, #397), or a
 * RegExp entry matches the name or its snake_case form.
 */
export function isFiltered(model: ModelClass, given: string): boolean {
  const attribute = attributeName(model, given);
  if (secretAttributeNames(model.attributeDefinitions).has(attribute)) return true;
  const names = [
    attribute,
    ...[...model.attributeAliases].filter(([, name]) => name === attribute).map(([alias]) => alias),
  ];
  return names.some((name) => isNameFiltered(model, name));
}

/** Whether one name matches an entry of `model`'s `filterAttributes`. */
function isNameFiltered(model: ModelClass, attribute: string): boolean {
  const name = underscore(attribute); // already lowercase
  return model.filterAttributes.some((entry) =>
    typeof entry === "string"
      ? name.includes(entry.toLowerCase()) || name.includes(underscore(entry))
      : attribute.search(entry) !== -1 || name.search(entry) !== -1,
  );
}

/** The values of `attributes` that `model` filters, so a message can tell not to show them. */
export function filteredValues(model: ModelClass, attributes: Record<string, unknown>): unknown[] {
  return Object.entries(attributes)
    .filter(([name]) => isFiltered(model, name))
    .map(([, value]) => value);
}

/** A bound value D1 gets as `value`, and listeners see as `shown`. */
export class Filtered {
  readonly value: unknown;
  readonly shown: unknown;

  constructor(value: unknown, shown: unknown = FILTERED) {
    this.value = value;
    this.shown = shown;
  }
}

/** A primary key as an error shows it: "[FILTERED]" when the key is a filtered attribute. */
export function shownKey(model: ModelClass, key: unknown): string {
  return isFiltered(model, model.primaryKey) ? FILTERED : String(key);
}

/** The value D1 binds. */
export function boundValue(param: unknown): unknown {
  return param instanceof Filtered ? param.value : param;
}

/** The value listeners see. */
export function shownValue(param: unknown): unknown {
  return param instanceof Filtered ? param.shown : param;
}
