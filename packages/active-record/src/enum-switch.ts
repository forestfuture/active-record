// An override's `enum: true` (#64): a generated enum's names, with the methods its schema leaves off.
import type { SpecObject } from "./metadata.ts";

/** An override as written, with its `enum` switch apart from its other changes. */
export interface SwitchedOverride {
  /** `true` to turn a generated enum's methods on. */
  switched?: true;
  change: object;
}

/** Takes an override's `enum: true` out of it, so its other changes are checked as any override's. */
export function takeEnumSwitch(override: object): SwitchedOverride {
  if (!("enum" in override) || override.enum !== true) return { change: override };
  const { enum: _switch, ...change } = override;
  return { switched: true, change };
}

/**
 * A generated spec as an override's switch leaves it: `enum: true` lifts the `scopes: false` and
 * `instanceMethods: false` the schema wrote, so an enum's defaults apply, and the override's own
 * switches, applied after, win.
 */
export function switchedSpec(spec: SpecObject, switched: true | undefined): SpecObject {
  if (switched === undefined) return spec;
  const { scopes: _scopes, instanceMethods: _instanceMethods, ...lifted } = spec;
  return lifted;
}
