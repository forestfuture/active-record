// `validatesAssociated` (#343): an association's records, loaded if they aren't, validated with their owner, each once per validation of it.
import { associationsOf } from "./association-fields.ts";
import { validation, type Claimed, type Validity } from "./lifecycle.ts";
import type { Model } from "./model.ts";
import { modelOf } from "./model.ts";
import { state } from "./record-state.ts";

/**
 * The records validated while their owner is, with what each came to: a record that
 * `validatesAssociated` and autosave both validate is validated once.
 */
export type Validated = Map<Model, Validity>;

/** A record's validity, validated once per owner validation. */
export async function validityOf(
  record: Model,
  claimed: Claimed,
  validated: Validated,
): Promise<Validity> {
  let validity = validated.get(record);
  if (validity === undefined) {
    validity = await validation(record, claimed);
    validated.set(record, validity);
  }
  return validity;
}

/**
 * Whether every record of `owner`'s association `name` is valid, reading it as its accessor does
 * (a query when it isn't loaded). A record marked for destruction isn't validated, as in Rails.
 */
export async function isAssociationValid(
  owner: Model,
  name: string,
  claimed: Claimed,
  validated: Validated,
): Promise<boolean> {
  let valid = true;
  for (const record of await recordsOf(owner, name)) {
    if (record[state].isMarkedForDestruction) continue;
    if ((await validityOf(record, claimed, validated)) !== "valid") valid = false;
  }
  return valid;
}

/** The association's records: a hasMany's, or a belongsTo's or hasOne's one, if it has one. */
async function recordsOf(owner: Model, name: string): Promise<readonly Model[]> {
  const read = (owner as unknown as Record<string, () => unknown>)[name]!();
  if (associationsOf(modelOf(owner)).get(name)?.kind === "hasMany") {
    return (read as { toArray: () => Promise<Model[]> }).toArray();
  }
  const record = (await read) as Model | null;
  return record === null ? [] : [record];
}
