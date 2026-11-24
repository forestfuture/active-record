// An override and a generated enum (#64): `enum: true` or an override's own list turns its methods on,
// `enum: false` drops it, and what a clash's message says to remove to leave them off again.
import { InvalidModel } from "./errors.ts";
import type { DatabaseSchema } from "./generated-model.ts";
import {
  specObjectOf,
  type AttributeDefinition,
  type AttributeSpecs,
  type SpecObject,
} from "./metadata.ts";
import { withoutEnum } from "./spec-keys.ts";

/** An override as written, with its `enum: true` or `false` apart from its other changes. */
export interface SplitOverride<C = unknown> {
  /** `enum: true`: use the database's names, methods on; `enum: false`: drop them. */
  useDatabaseEnum?: boolean;
  change: C;
}

/** Takes an override's `enum: true` or `false` out of it, so its other changes are checked as any override's. */
export function takeEnumSwitch(override: unknown): SplitOverride {
  if (typeof override !== "object" || override === null) return { change: override };
  if (!("enum" in override) || typeof override.enum !== "boolean") return { change: override };
  const { enum: useDatabaseEnum, ...change } = override;
  return { useDatabaseEnum, change };
}

/**
 * A generated spec as an override's switch leaves it: `enum: true` lifts the `scopes: false` and
 * `instanceMethods: false` the schema wrote, so an enum's defaults apply, and the override's own
 * switches, applied after, win; so does an override's own list, which replaces the names.
 * `enum: false` drops the enum and its keys. Either switch is an `InvalidModel` on a column
 * without a generated enum.
 */
export function generatedEnumBase(
  where: string,
  spec: SpecObject,
  { useDatabaseEnum, change }: SplitOverride<object>,
): SpecObject {
  if (useDatabaseEnum === undefined) return hasOwnNames(change) ? withMethodsOn(spec) : spec;
  if (spec.enum === undefined) throw new InvalidModel(nothingToSwitch(where, useDatabaseEnum));
  return useDatabaseEnum ? withMethodsOn(spec) : withoutEnum(spec);
}

/** Whether an override gives an enum's names itself: a list or a mapping, not `undefined`. */
function hasOwnNames(change: object): boolean {
  return "enum" in change && change.enum !== undefined;
}

/** A spec without the switches a generated enum's methods are off by, so an enum's defaults apply. */
function withMethodsOn(spec: SpecObject): SpecObject {
  const { scopes: _scopes, instanceMethods: _instanceMethods, ...lifted } = spec;
  return lifted;
}

/** Why a switch has nothing to act on, and what to write instead of `enum: true`. */
function nothingToSwitch(where: string, useDatabaseEnum: boolean): string {
  return useDatabaseEnum
    ? `${where} has no enum from the database to turn on; list its names instead (enum: ["…", …])`
    : `${where} has no enum from the database to turn off`;
}

/** A Model as `methodsOffFixes` reads it: its schema, table and overrides, and its attributes. */
interface SchemaModel {
  readonly schema?: DatabaseSchema;
  readonly table: string;
  readonly attributes?: unknown;
  readonly attributeDefinitions: ReadonlyMap<string, AttributeDefinition>;
}

/** The method switches an override turns on, as written: `enum: true`, or `scopes: true`, … */
const methodSwitches = ["enum", "scopes", "instanceMethods"] as const;

/** An override as an object of keys, whatever was written: `{}` for a type name, `false` or none. */
function overrideKeys(override: unknown): Readonly<Record<string, unknown>> {
  return typeof override === "object" && override !== null
    ? (override as Record<string, unknown>)
    : {};
}

/**
 * What to remove from an attribute's override to leave its database enum's methods off again
 * (`enum: true`), or undefined: no enum from the database, its methods off, or a list of its own.
 */
function methodsOffFix(
  spec: AttributeSpecs[string] | undefined,
  definition: AttributeDefinition,
  override: Readonly<Record<string, unknown>>,
): string | undefined {
  const isFromDatabase = spec !== undefined && specObjectOf(spec).enum !== undefined;
  if (!isFromDatabase || definition.enum === undefined || typeof override["enum"] === "object") {
    return undefined;
  }
  const turnedOn = methodSwitches.filter((key) => override[key] === true);
  return turnedOn.length === 0 ? undefined : turnedOn.map((key) => `${key}: true`).join(" and ");
}

/** For each enum whose names the database gave, with its methods on, `methodsOffFix`'s answer (#64). */
export function methodsOffFixes(model: SchemaModel): ReadonlyMap<string, string> {
  const table = model.schema?.tables[model.table]?.attributes ?? {};
  const overrides = overrideKeys(model.attributes);
  const fixes = new Map<string, string>();
  for (const [attribute, definition] of model.attributeDefinitions) {
    const fix = methodsOffFix(table[attribute], definition, overrideKeys(overrides[attribute]));
    if (fix !== undefined) fixes.set(attribute, fix);
  }
  return fixes;
}
