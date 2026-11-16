// `validatesAssociated` (#343): an association's records, loaded if they aren't, validated with their owner, each once per validation pass, and a cycle ended.
import { readAssociation } from "./association-fields.ts";
import { validation, type Claimed, type Validity } from "./lifecycle.ts";
import { modelOf, type Model, type ModelClass } from "./model.ts";
import { state } from "./record-state.ts";

/**
 * One validation of a record, and of the records validated with it at every level: what each
 * came to, so a record that `validatesAssociated` and autosave both validate is validated once,
 * and the records still being validated, so a cycle ends.
 */
export interface ValidationPass {
  readonly validities: Map<Model, Validity>;
  /** The records being validated. */
  readonly inProgress: Set<Model>;
  /** The rows of those that are saved and unchanged, by Model: a load gives a copy of one. */
  readonly rowsInProgress: Map<ModelClass, Set<unknown>>;
  /** The associations `validatesAssociated` found invalid, by owner: autosave doesn't add theirs. */
  readonly invalidAssociations: Map<Model, Set<string>>;
}

/** A pass for validating a record and the records validated with it. */
export function newPass(): ValidationPass {
  return {
    validities: new Map(),
    inProgress: new Set(),
    rowsInProgress: new Map(),
    invalidAssociations: new Map(),
  };
}

/** Runs `validate` with `record` marked as being validated in `pass`. */
export async function whileValidating<T>(
  pass: ValidationPass,
  record: Model,
  validate: () => Promise<T>,
): Promise<T> {
  const row = rowOf(record);
  pass.inProgress.add(record);
  if (row) rowsOf(pass, row.model).add(row.key);
  try {
    return await validate();
  } finally {
    pass.inProgress.delete(record);
    if (row) rowsOf(pass, row.model).delete(row.key);
  }
}

/** Whether `record` is being validated in `pass`, or is an unchanged copy of a row that is. */
function isInProgress(pass: ValidationPass, record: Model): boolean {
  if (pass.inProgress.has(record)) return true;
  const row = rowOf(record);
  return row !== undefined && rowsOf(pass, row.model).has(row.key);
}

/**
 * A saved record's Model and key, while it has no unsaved changes: a copy with changes of its
 * own is validated for them.
 */
function rowOf(record: Model): { model: ModelClass; key: unknown } | undefined {
  const recordState = record[state];
  const key = recordState.isNew ? undefined : recordState.storedKeyValue;
  if (key === undefined || key === null || record.isChanged()) return undefined;
  return { model: modelOf(record), key };
}

function rowsOf(pass: ValidationPass, model: ModelClass): Set<unknown> {
  let rows = pass.rowsInProgress.get(model);
  if (rows === undefined) pass.rowsInProgress.set(model, (rows = new Set()));
  return rows;
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
  if (isInProgress(pass, record)) return "valid";
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
  const read = await readAssociation(owner, name);
  const records = Array.isArray(read) ? read : read === null ? [] : [read];
  for (const record of records) {
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
