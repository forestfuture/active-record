// `validatesAssociated` (#343): an association's records, loaded if they aren't, validated with their owner in its validation pass.
import { readAssociation } from "./association-fields.ts";
import type { Claimed } from "./lifecycle.ts";
import type { Model } from "./model.ts";
import { state } from "./record-state.ts";
import { validityOf, type ValidationPass } from "./validation-pass.ts";

/**
 * Whether every record of `owner`'s association `name` is valid, reading it as its accessor does
 * (a query when it isn't loaded). A record marked for destruction isn't validated.
 */
export async function isAssociationValid(
  owner: Model,
  name: string,
  claimed: Claimed,
  pass: ValidationPass,
): Promise<boolean> {
  let valid = true;
  for (const record of recordsIn(await readAssociation(owner, name))) {
    if (record[state].isMarkedForDestruction) continue;
    if ((await validityOf(record, claimed, pass)) !== "valid") valid = false;
  }
  if (!valid) {
    const names = pass.reportedInvalid.get(owner) ?? new Set();
    pass.reportedInvalid.set(owner, names.add(name));
  }
  return valid;
}

/** Whether `validatesAssociated` found the owner's association invalid in this pass. */
export function isReportedInvalid(pass: ValidationPass, owner: Model, name: string): boolean {
  return pass.reportedInvalid.get(owner)?.has(name) === true;
}

/** An association's records, as a list: a hasMany's, or a belongsTo's or hasOne's one, if any. */
function recordsIn(read: Model[] | Model | null): readonly Model[] {
  if (Array.isArray(read)) return read;
  return read === null ? [] : [read];
}
