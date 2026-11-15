// An override's `enum: true` and `enum: false` (#64): a generated enum's names with the methods its
// schema leaves off, or the column without them; and which enums' names a Model's schema gave it.
import { InvalidModel } from "./errors.ts";
import type { DatabaseSchema } from "./generated-model.ts";
import type { AttributeDefinition, SpecObject } from "./metadata.ts";
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
export function switchedSpec(
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

/** A Model as `databaseEnumsOf` reads it: its schema and table, and its attributes as overridden. */
interface SchemaModel {
  readonly schema?: DatabaseSchema;
  readonly table: string;
  readonly attributeDefinitions: ReadonlyMap<string, AttributeDefinition>;
}

/**
 * The enum attributes whose names the database gave: those whose names are the ones its schema's
 * table lists, not a list of the Model's own (#64).
 */
export function databaseEnumsOf(model: SchemaModel): ReadonlySet<string> {
  const table = model.schema?.tables[model.table]?.attributes ?? {};
  const fromDatabase = new Set<string>();
  for (const [attribute, definition] of model.attributeDefinitions) {
    const spec = table[attribute];
    const listed = typeof spec === "object" ? spec.enum : undefined;
    if (listed !== undefined && JSON.stringify(listed) === JSON.stringify(definition.enum)) {
      fromDatabase.add(attribute);
    }
  }
  return fromDatabase;
}
