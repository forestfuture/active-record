// A validation pass (#343): one record's validation and those of the records validated with it, at every level, each validated once, and a cycle ended.
import { validation, type Claimed, type Validity } from "./lifecycle.ts";
import { modelOf, type Model, type ModelClass } from "./model.ts";
import { state } from "./record-state.ts";
import { customContextOf, type ValidationContexts } from "./validation-context.ts";

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
  /** The associations `validatesAssociated` reported invalid, by owner: autosave doesn't again. */
  readonly reportedInvalid: Map<Model, Set<string>>;
  /**
   * The custom context the pass's records are validated in (#51), if it has one; otherwise each
   * is validated in its own, `"create"` or `"update"`.
   */
  readonly context: readonly string[] | undefined;
}

/**
 * A pass for validating a record, in `context` if given, and the records validated with it,
 * which share the context only if it's custom, as Rails does.
 */
export function newPass(context?: ValidationContexts): ValidationPass {
  return {
    context: customContextOf(context),
    validities: new Map(),
    inProgress: new Set(),
    rowsInProgress: new Map(),
    reportedInvalid: new Map(),
  };
}

/** Runs `validate` with `record` marked as being validated in `pass`, in `contexts` (#51). */
export async function whileValidating<T>(
  pass: ValidationPass,
  record: Model,
  contexts: readonly string[],
  validate: () => Promise<T>,
): Promise<T> {
  const row = rowOf(record);
  pass.inProgress.add(record);
  if (row) rowsOf(pass, row.model).add(row.key);
  record[state].validationContexts = contexts;
  try {
    return await validate();
  } finally {
    record[state].validationContexts = [];
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
