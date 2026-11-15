// An override's `enum: true` and `enum: false` (#64): a generated enum's names with the methods its
// schema leaves off, or the column without them.
import { InvalidModel } from "./errors.ts";
import type { SpecObject } from "./metadata.ts";

/** An override as written, with its `enum` switch apart from its other changes. */
export interface SwitchedOverride {
  /** `true` to turn a generated enum's methods on, `false` to drop the enum. */
  switched?: boolean;
  change: object;
}

/** Takes an override's `enum: true` or `false` out of it, so its other changes are checked as any override's. */
export function takeEnumSwitch(override: object): SwitchedOverride {
  if (!("enum" in override) || typeof override.enum !== "boolean") return { change: override };
  const { enum: switched, ...change } = override;
  return { switched, change };
}

/**
 * A generated spec as an override's switch leaves it: `enum: true` lifts the `scopes: false` and
 * `instanceMethods: false` the schema wrote, so an enum's defaults apply, and the override's own
 * switches, applied after, win. Either is an `InvalidModel` on a column without a generated enum.
 */
export function switchedSpec(
  where: string,
  spec: SpecObject,
  switched: boolean | undefined,
): SpecObject {
  if (switched === undefined) return spec;
  if (spec.enum === undefined) throw new InvalidModel(nothingToSwitch(where, switched));
  const { scopes: _scopes, instanceMethods: _instanceMethods, ...lifted } = spec;
  return lifted;
}

/** Why a switch has nothing to act on, and what to write instead of `enum: true`. */
function nothingToSwitch(where: string, switched: boolean): string {
  return switched
    ? `${where} has no enum from the database to turn on; list its names instead (enum: ["…", …])`
    : `${where} has no enum from the database to turn off`;
}
