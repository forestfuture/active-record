// A belongsTo's `touch` (#353) and a hasOne's (#497): checking its declaration, and the touches a record's create, update, destroy or touch makes of the records it belongs to or has, in its batch.
import { asStored } from "./normalized-values.ts";
import { associationsOf, readAssociation } from "./association-fields.ts";
import type { AssociationDefinition } from "./associations.ts";
import { isDestroyedThrough } from "./counter-caches.ts";
import { touchAssignments } from "./counters.ts";
import { InvalidModel } from "./errors.ts";
import { isCoveredByNoTouching } from "./no-touching.ts";
import { Model, modelOf, type ModelClass } from "./model.ts";
import { state } from "./record-state.ts";
import {
  belongsToKeys,
  isOnDifferentDatabases,
  resolveAssociation,
} from "./resolved-association.ts";
import { touchWrite } from "./touch.ts";
import { isLocking } from "./lock-version.ts";
import type { PreparedWrite } from "./unit-of-work.ts";

/**
 * A belongsTo's or hasOne's `touch` (#497) is `true` or datetime attributes' names, each Model it
 * points at has what it sets, and it's on the record's database, as the touch is written in its
 * batch.
 */
export function checkTouch(
  label: string,
  owner: ModelClass,
  definition: AssociationDefinition,
  targets: readonly ModelClass[],
): void {
  const { touch, kind } = definition;
  if (touch === undefined) return;
  if (kind === "hasMany") {
    throw new InvalidModel(
      `${label}: a hasMany takes no touch; only a belongsTo or hasOne touches`,
    );
  }
  const names = touchNames(label, touch, targets);
  for (const target of targets) requireTouchable(label, target, touch === true ? [] : names);
  const elsewhere = targets.find((target) => isOnDifferentDatabases(owner, target));
  if (elsewhere !== undefined) {
    throw new InvalidModel(
      `${label} touches a record on another database, which it can't yet: ${owner.name} and ${elsewhere.name} must be on one`,
    );
  }
}

/** The names `touch` gives: none for `true`, else one or a list of strings. */
function touchNames(label: string, touch: unknown, targets: readonly ModelClass[]): string[] {
  if (touch === true) return [];
  const names = Array.isArray(touch) ? touch : [touch];
  if (names.length > 0 && names.every((name) => typeof name === "string")) return names;
  const models = targets.map((target) => target.name).join(" or ");
  throw new InvalidModel(
    `${label}: touch takes true, the name of a datetime attribute of ${models}, or a list of them`,
  );
}

/** `target` has `updatedAt` for `touch: true`, and each named attribute as a datetime. */
function requireTouchable(label: string, target: ModelClass, names: readonly string[]): void {
  const isDatetime = (name: string) => target.attributeDefinitions.get(name)?.type === "datetime";
  if (names.length === 0 && !isDatetime("updatedAt")) {
    throw new InvalidModel(
      `${label}: touch: true sets ${target.name}'s updatedAt, which it doesn't have (name a datetime attribute)`,
    );
  }
  const wrong = names.find((name) => !isDatetime(name));
  if (wrong !== undefined) {
    throw new InvalidModel(
      `${label}: touch takes ${target.name}'s datetime attributes; "${wrong}" isn't one`,
    );
  }
}

/** What a record's write is, which decides the records it touches. */
export type TouchCause = "insert" | "update" | "destroy" | "touch";

/**
 * One write's touches: the time each sets, once known, the records already touched (by table and
 * key, so each is touched once), and those the write saves through their owners, which a hasOne
 * leaves to those saves (#497).
 */
interface TouchSession {
  time: Date | undefined;
  touched: Set<string | Model>;
  autosaved: Set<Model>;
}

/** Each write's touch session, by the set of records it claims. */
const sessions = new WeakMap<ReadonlySet<Model>, TouchSession>();

/**
 * The touch session of the write claiming `claimed`, started on its first touch, at `time` when
 * it's given (as `touch()` gives it).
 */
function sessionOf(claimed: ReadonlySet<Model>, time?: Date): TouchSession {
  let session = sessions.get(claimed);
  if (session === undefined) {
    session = { time, touched: new Set(), autosaved: new Set() };
    sessions.set(claimed, session);
  }
  return session;
}

/**
 * The time the session's touches set: taken when the first is sent, after the write's saves
 * have stamped their own, so a row a save stamps isn't set back.
 */
function timeOf(session: TouchSession): Date {
  session.time ??= new Date();
  return session.time;
}

/**
 * What tells two touched records apart: a saved record's table and stored key, so two instances
 * of a row are one; a new record has no row yet, so it's itself.
 */
function touchKey(record: Model): string | Model {
  if (record[state].isNew) return record;
  return `${modelOf(record).table} ${JSON.stringify(record[state].storedKeyValue)}`;
}

/**
 * The touches `record.touch()` makes in turn, at the `time` it sets: the record itself counts
 * as touched, so records touching each other touch it once.
 */
export function touchesOfTouch(record: Model, time: Date): Promise<PreparedWrite[]> {
  const claimed = new Set([record]);
  markTouched(record, claimed, time);
  return touchesOf(record, "touch", claimed);
}

/** Counts `record` as touched by the write claiming `claimed`, so no touch reaches it again. */
function markTouched(record: Model, claimed: ReadonlySet<Model>, time?: Date): void {
  sessionOf(claimed, time).touched.add(touchKey(record));
}

/**
 * The touches `record`'s save makes: none for an update that changes nothing. Its own row takes
 * none of them back (#497), as its save sets its time; another entry of its batch may touch it.
 */
export async function touchesOfSave(
  record: Model,
  isInsert: boolean,
  claimed: ReadonlySet<Model>,
): Promise<PreparedWrite[]> {
  if (!isInsert && record[state].changedNames().length === 0) return [];
  const cause = isInsert ? "insert" : "update";
  const { touched } = sessionOf(claimed);
  const key = touchKey(record);
  if (touched.has(key)) return touchesOf(record, cause, claimed);
  touched.add(key);
  try {
    return await touchesOf(record, cause, claimed);
  } finally {
    touched.delete(key);
  }
}

/**
 * Leaves `records`, which the write claiming `claimed` saves or destroys through their owner
 * after it, to those writes: a hasOne doesn't touch them (#497), as their saves set their time.
 */
export function leaveToAutosaves(
  records: readonly { record: Model }[],
  claimed: ReadonlySet<Model>,
): void {
  const { autosaved } = sessionOf(claimed);
  for (const { record } of records) autosaved.add(record);
}

/**
 * The touches `record`'s write makes (#353): each record a belongsTo or hasOne (#497) declaring
 * `touch` reaches, loaded if it isn't, touched by its own touch write, and the records it
 * touches in turn. A destroyed record counts as touched, so none touches it back. A
 * `noTouching` block leaves out the records it covers (#496), and an association whose every
 * Model it covers isn't read.
 */
export async function touchesOf(
  record: Model,
  cause: TouchCause,
  claimed: ReadonlySet<Model>,
): Promise<PreparedWrite[]> {
  // Only a persisted record is touched.
  if (cause === "destroy") markTouched(record, claimed);
  const writes: PreparedWrite[] = [];
  const model = modelOf(record);
  for (const [name, definition] of associationsOf(model)) {
    if (!isTouching(record, cause, definition)) continue;
    if (isEveryTargetCovered(model, name)) continue;
    for (const target of await touchedRecords(record, name, definition, claimed)) {
      writes.push(...(await touchOne(target, definition, claimed)));
    }
  }
  return writes;
}

/**
 * Whether an association touches on `record`'s write: one declaring `touch`, but not a hasOne
 * on its owner's create (#497), nor on a destroy that deletes the record it reaches with its own.
 */
function isTouching(
  record: Model,
  cause: TouchCause,
  { kind, touch, foreignKey, dependent }: AssociationDefinition,
): boolean {
  if (touch === undefined) return false;
  if (kind === "hasOne" && cause === "insert") return false;
  if (cause !== "destroy") return true;
  // Its owner is being deleted with it, so it isn't touched.
  if (kind === "belongsTo") return !isDestroyedThrough(record, foreignKey);
  // A hasOne's record its dependent removes (only a persisted one is touched).
  return dependent !== "destroy" && dependent !== "delete";
}

/**
 * Whether a `noTouching` block covers every Model association `name` can reach (#496): its one
 * Model, or each a polymorphic belongsTo lists. Then nothing it reaches is touched, so it isn't read.
 */
function isEveryTargetCovered(model: ModelClass, name: string): boolean {
  const { branches } = resolveAssociation(model, name);
  return branches.every((branch) => isCoveredByNoTouching(branch.target));
}

/**
 * The records `record`'s association `name` touches: the one it reaches, and, when a belongsTo's
 * key differs from the row's, the one the row's key reaches, as the association reads it; each
 * with a row to touch once the write is sent. A hasOne's record the write saves through an owner
 * is left to that save.
 */
async function touchedRecords(
  record: Model,
  name: string,
  definition: AssociationDefinition,
  claimed: ReadonlySet<Model>,
): Promise<Model[]> {
  const current = await readAssociation(record, name);
  if (definition.kind === "hasOne") {
    const isAutosaved = current instanceof Model && sessionOf(claimed).autosaved.has(current);
    return isTouchable(current, claimed) && !isAutosaved ? [current] : [];
  }
  const stored = isMoved(record, definition) ? await readStored(record, name) : null;
  return [current, stored].filter((each) => isTouchable(each, claimed));
}

/** Whether a saved record's belongsTo points elsewhere than its row does. */
function isMoved(record: Model, definition: AssociationDefinition): boolean {
  const recordState = record[state];
  if (recordState.isNew) return false;
  return belongsToKeys(definition).some((key) => recordState.isAttributeChanged(key));
}

/**
 * The record a belongsTo reaches by the key (and a polymorphic one's type) in the record's row,
 * found through the association, so its scope and the target's default scope apply.
 */
async function readStored(record: Model, name: string): Promise<Model | null> {
  const recordState = record[state];
  const association = resolveAssociation(modelOf(record), name);
  const { foreignKey, foreignType } = association.definition;
  const type = foreignType === undefined ? undefined : recordState.valueInDatabase(foreignType);
  const branch = association.branches.find((each) => each.type?.value === type);
  const key = recordState.valueInDatabase(foreignKey);
  if (branch === undefined || key === null || key === undefined) return null;
  const query = branch
    .all(recordState.executor)
    .findBy(asStored({ [branch.targetAttribute]: key }));
  return (await query) as Model | null;
}

/**
 * A record with a row to touch once the write is sent: one that's saved and isn't destroyed, or
 * a new one the write inserts itself, touched after its insert.
 */
function isTouchable(record: unknown, claimed: ReadonlySet<Model>): record is Model {
  if (!(record instanceof Model)) return false;
  const recordState = record[state];
  if (recordState.isNew) return claimed.has(record);
  return !recordState.isDestroyed;
}

/**
 * `target`'s touch write, setting what the association's `touch` names, then those it makes in
 * turn; nothing if this write has touched it already, or `noTouching` turned its Model's touches
 * off (#496).
 */
async function touchOne(
  target: Model,
  { touch }: AssociationDefinition,
  claimed: ReadonlySet<Model>,
): Promise<PreparedWrite[]> {
  const session = sessionOf(claimed);
  const model = modelOf(target);
  const key = touchKey(target);
  if (session.touched.has(key) || isCoveredByNoTouching(model)) return [];
  session.touched.add(key);
  let values: Record<string, unknown> | undefined;
  const valuesOf = () =>
    (values ??= Object.fromEntries(touchAssignments(model, touch, "touch", timeOf(session))));
  const write = touchWrite(target, valuesOf, {
    keepsSavedChanges: () => isClaimedRow(target, claimed),
    increments: isLocking(model),
  });
  return [inWrite(write, target, claimed), ...(await touchesOf(target, "touch", claimed))];
}

/**
 * The records the write claims that are `record`'s row, by table and key, asked once inserted
 * records have their keys: another instance of the row may be the one claimed.
 */
function sameRow(record: Model, claimed: ReadonlySet<Model>): Model[] {
  return [...claimed].filter((each) => touchKey(each) === touchKey(record));
}

/** Whether the write saves or destroys `record`'s row itself. */
function isClaimedRow(record: Model, claimed: ReadonlySet<Model>): boolean {
  return sameRow(record, claimed).length > 0;
}

/**
 * A touch write as part of another record's write. What it does to its record is asked as each
 * step runs, when the write's records are claimed and inserted ones have their keys, by row
 * (another instance may be the one claimed): a row destroyed by then takes nothing, and a row the
 * write destroys runs no touch callback (only a persisted record is touched); a row the write
 * saves itself runs its commit and rollback callbacks once, from its own save.
 */
function inWrite(write: PreparedWrite, target: Model, claimed: ReadonlySet<Model>): PreparedWrite {
  const isDestroyed = () =>
    target[state].isDestroyed || sameRow(target, claimed).some((each) => each[state].isDestroyed);
  return {
    // Read as it's sent, not now: a new record's key isn't known yet.
    get statements() {
      return write.statements;
    },
    commit: (results) => {
      if (!isDestroyed()) write.commit(results);
    },
    after: async () => {
      if (!isDestroyed()) await write.after();
    },
    afterCommit: async () => {
      if (!isClaimedRow(target, claimed)) await write.afterCommit?.();
    },
    afterRollback: async (error) => {
      if (!isClaimedRow(target, claimed)) await write.afterRollback?.(error);
    },
  };
}
