// Attribute metadata: each attribute's type, column and default, resolved from its spec.
import { copiedKeys } from "./spec-keys.ts";
import type { EpochStorage } from "./epoch-storage.ts";
import { UnknownAttribute } from "./errors.ts";
import type { ModelClass } from "./model.ts";
import { underscore } from "./naming.ts";

export type AttributeType = "string" | "integer" | "real" | "boolean" | "datetime" | "json";

/** An attribute's spec written out: its type, and optionally nullability, column and default. */
export interface SpecObject {
  type: AttributeType;
  null?: boolean;
  column?: string;
  /** A `datetime` held as a Unix epoch integer, as Drizzle's timestamp modes write it (#73). */
  storage?: EpochStorage;
  /** Evaluated at `build()`, e.g. `() => new Date()`. */
  default?: () => unknown;
  /**
   * Made by the Model's `generateId` when not given, where a default would run: an
   * app-generated key (#99). Generated ids are strings, so only a string attribute has one.
   */
  generateId?: boolean;
}

/** Where a string attribute's value comes from when it isn't given: a default or `generateId`, never both. */
export type ValueSource =
  | { default?: () => unknown; generateId?: false }
  | { default?: never; generateId: true };

export type AttributeSpec =
  | AttributeType
  | (Omit<SpecObject, "default" | "generateId" | "storage"> & {
      type: "string";
      storage?: never;
    } & ValueSource)
  | (Omit<SpecObject, "type" | "generateId" | "storage"> & {
      type: Exclude<AttributeType, "string" | "datetime">;
      generateId?: false;
      storage?: never;
    })
  | (Omit<SpecObject, "type" | "generateId"> & { type: "datetime"; generateId?: false });

export type AttributeSpecs = Record<string, AttributeSpec>;

/**
 * `A`, with any key a spec doesn't have typed `never`, so a misspelled one (`nul: false`) is a
 * compile error: a generic parameter skips TypeScript's own check for unknown keys (#102).
 */
export type ExactSpecs<A> = {
  [K in keyof A]: A[K] extends object
    ? A[K] & Record<Exclude<keyof A[K], keyof SpecObject>, never>
    : A[K];
};

/** An attribute's resolved metadata. */
export interface AttributeDefinition {
  type: AttributeType;
  column: string;
  default?: () => unknown;
  generateId?: true;
  storage?: EpochStorage;
}

type JsType<T extends AttributeType> = T extends "string"
  ? string
  : T extends "integer" | "real"
    ? number
    : T extends "boolean"
      ? boolean
      : T extends "datetime"
        ? Date
        : unknown;

type AttributeValue<S> = S extends AttributeType
  ? JsType<S> | null
  : S extends { type: infer T extends AttributeType; null: false }
    ? JsType<T>
    : S extends { type: infer T extends AttributeType }
      ? JsType<T> | null
      : never;

export type AttributeProperties<A extends AttributeSpecs> = {
  -readonly [K in keyof A]: AttributeValue<A[K]>;
};

/** Resolves an attribute's spec into its type, column and default. */
export function define(name: string, spec: AttributeSpec): AttributeDefinition {
  return typeof spec === "string"
    ? { type: spec, column: underscore(name) }
    : { type: spec.type, column: spec.column ?? underscore(name), ...copiedKeys(spec) };
}

/** Looks up a declared attribute; throws `UnknownAttribute` for any other name. */
export function attributeOf(
  model: {
    readonly name: string;
    readonly attributeDefinitions: ModelClass["attributeDefinitions"];
  },
  name: string,
): AttributeDefinition {
  const attribute = model.attributeDefinitions.get(name);
  if (attribute === undefined) {
    throw new UnknownAttribute(`${model.name} has no attribute "${name}"`);
  }
  return attribute;
}

/** The attribute names mapped to `column` (usually one; none if the column isn't declared). */
export function attributesForColumn(model: ModelClass, column: string): string[] {
  return [...model.attributeDefinitions]
    .filter(([, definition]) => definition.column === column)
    .map(([name]) => name);
}

/** `undefined` would silently store NULL, so writing it throws `TypeError` (use `null`). */
export function requireDefined(model: ModelClass, name: string, value: unknown): void {
  if (value === undefined) {
    throw new TypeError(`${model.name}: got undefined for "${name}"; use null to store NULL`);
  }
}

/**
 * The initial values of every attribute not in `given` that has one, made now: each one's
 * `default`, or for a generated id, the Model's `generateId(name)`.
 */
export function initialValues(model: ModelClass, given: object = {}): [string, unknown][] {
  return [...model.attributeDefinitions]
    .filter(([name, definition]) => !(name in given) && hasInitialValue(definition))
    .map(([name, definition]) => [
      name,
      definition.generateId ? model.generateId(name) : definition.default!(),
    ]);
}

/** Whether an attribute gets a value when none is given: from its `default`, or `generateId`. */
function hasInitialValue(definition: AttributeDefinition): boolean {
  return definition.generateId === true || definition.default !== undefined;
}
