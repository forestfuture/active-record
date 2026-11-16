// `validatesAssociated` (#343): an association's records, loaded if they aren't, validated with their owner, each once per validation pass, and a cycle ended.
import { associationsOf } from "./association-fields.ts";
import { validation, type Claimed, type Validity } from "./lifecycle.ts";
import type { Model } from "./model.ts";
import { modelOf } from "./model.ts";
import { state } from "./record-state.ts";

/**
 * One validation of a record, and of the records validated with it at every level: what each
 * came to, so a record that `validatesAssociated` and autosave both validate is validated once,
 * and the records still being validated, so a cycle ends.
 */
export interface ValidationPass {
  readonly validities: Map<Model, Validity>;
  /** Each record being validated, and the row of each saved one, since a load gives a copy. */
  readonly inProgress: Set<unknown>;
  /** The associations `validatesAssociated` found invalid, by owner: autosave doesn't add theirs. */
  readonly invalidAssociations: Map<Model, Set<string>>;
}

/** A pass for validating `record` and the records validated with it. */
export function newPass(): ValidationPass {
  return { validities: new Map(), inProgress: new Set(), invalidAssociations: new Map() };
}

/** Runs `validate` with `record` marked as being validated in `pass`. */
export async function whileValidating<T>(
  pass: ValidationPass,
  record: Model,
  validate: () => Promise<T>,
): Promise<T> {
  const marks = marksOf(record);
  for (const mark of marks) pass.inProgress.add(mark);
  try {
    return await validate();
  } finally {
    for (const mark of marks) pass.inProgress.delete(mark);
  }
}

/** A record and, once it's saved, its row: its table and key. */
function marksOf(record: Model): unknown[] {
  const recordState = record[state];
  if (recordState.isNew) return [record];
  return [record, `${modelOf(record).table}\0${String(recordState.storedKeyValue)}`];
}

/**
 * A record's validity, validated once per pass. One still being validated higher up counts as
 * valid, so `validatesAssociated` on both sides of an association, or through an inverse, ends.
 */
export async function validityOf(
  record: Model,
  claimed: Claimed,
  pass: ValidationPass,
): Promise<Validity> {
  if (marksOf(record).some((mark) => pass.inProgress.has(mark))) return "valid";
  let validity = pass.validities.get(record);
  if (validity === undefined) {
    validity = await validation(record, claimed, pass);
    pass.validities.set(record, validity);
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
  pass: ValidationPass,
): Promise<boolean> {
  let valid = true;
  for (const record of await recordsOf(owner, name)) {
    if (record[state].isMarkedForDestruction) continue;
    if ((await validityOf(record, claimed, pass)) !== "valid") valid = false;
  }
  if (!valid) {
    const names = pass.invalidAssociations.get(owner) ?? new Set();
    pass.invalidAssociations.set(owner, names.add(name));
  }
  return valid;
}

/** Whether `validatesAssociated` found the owner's association invalid in this pass. */
export function isReportedInvalid(pass: ValidationPass, owner: Model, name: string): boolean {
  return pass.invalidAssociations.get(owner)?.has(name) === true;
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
