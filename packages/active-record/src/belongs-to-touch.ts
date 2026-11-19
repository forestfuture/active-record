// A belongsTo's `touch` (#353): checking its declaration, and the touches a record's create, update, destroy or touch makes of the records it belongs to, in its batch.
import { associationOf, associationsOf, readAssociation } from "./association-fields.ts";
import type { AssociationDefinition } from "./associations.ts";
import {
  countedSides,
  hasCounterWritten,
  isDestroyedThrough,
  type CounterSide,
} from "./counter-caches.ts";
import { touchAssignments } from "./counters.ts";
import { InvalidModel } from "./errors.ts";
import { Model, modelOf, type ModelClass } from "./model.ts";
import { state } from "./record-state.ts";
import {
  belongsToKeys,
  isOnDifferentDatabases,
  resolveAssociation,
} from "./resolved-association.ts";
import { touchWrite, type TouchWriteOptions } from "./touch.ts";
import type { PreparedWrite } from "./unit-of-work.ts";

/**
 * A belongsTo's `touch` is `true` or datetime attributes' names, each Model it points at has
 * what it sets, and it's on the record's database, as the touch is written in its batch.
 */
export function checkTouch(
  label: string,
  owner: ModelClass,
  definition: AssociationDefinition,
  targets: readonly ModelClass[],
): void {
  const { touch, kind } = definition;
  if (touch === undefined) return;
  if (kind !== "belongsTo") {
    throw new InvalidModel(`${label}: a ${kind} takes no touch; only a belongsTo touches`);
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
 * One write's touches: the time each sets, and the records already touched (by table and key,
 * so each is touched once).
 */
interface TouchSession {
  time: Date;
  touched: Set<string | Model>;
}

/** Each write's touch session, by the set of records it claims. */
const sessions = new WeakMap<ReadonlySet<Model>, TouchSession>();

/** The time the write claiming `claimed` touches records at, which its counters' touch sets too. */
export function touchTimeOf(claimed: ReadonlySet<Model>): Date {
  return sessionOf(claimed).time;
}

/**
 * The touch session of the write claiming `claimed`, started at `time` (now by default) on its
 * first touch.
 */
function sessionOf(claimed: ReadonlySet<Model>, time = new Date()): TouchSession {
  let session = sessions.get(claimed);
  if (session === undefined) {
    session = { time, touched: new Set() };
    sessions.set(claimed, session);
  }
  return session;
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
  sessionOf(claimed, time).touched.add(touchKey(record));
  return touchesOf(record, "touch", claimed);
}

/**
 * The touches `record`'s write makes (#353): each record a belongsTo declaring `touch` reaches,
 * loaded if it isn't, touched by its own touch write, and the records it touches in turn.
 */
export async function touchesOf(
  record: Model,
  cause: TouchCause,
  claimed: ReadonlySet<Model>,
): Promise<PreparedWrite[]> {
  const writes: PreparedWrite[] = [];
  for (const [name, { kind, touch, foreignKey }] of associationsOf(modelOf(record))) {
    if (kind !== "belongsTo" || touch === undefined) continue;
    // Its owner is being deleted with it (Rails skips the destroyed owner).
    if (cause === "destroy" && isDestroyedThrough(record, foreignKey)) continue;
    const touched = await touchedRecords(record, name, cause, claimed);
    for (const { target, isWrittenByCounter } of touched) {
      writes.push(...(await touchOne(target, { touch, isWrittenByCounter }, claimed)));
    }
  }
  return writes;
}

/**
 * A record a write touches, and, when its counter cache's statement sets the time instead, a
 * function telling whether that statement wrote a row.
 */
interface TouchedRecord {
  target: Model;
  isWrittenByCounter: TouchWriteOptions["isWrittenByCounter"];
}

/**
 * The records `record`'s belongsTo `name` touches, each saved: the one it reaches, and, when
 * its key differs from the row's, the one the row's key reaches, as the association reads it.
 * Each the write's counter statements change takes the time from them.
 */
async function touchedRecords(
  record: Model,
  name: string,
  cause: TouchCause,
  claimed: ReadonlySet<Model>,
): Promise<TouchedRecord[]> {
  const isMovedKey = isMoved(record, name);
  const current = await readAssociation(record, name);
  const stored = isMovedKey ? await readStored(record, name) : null;
  const sides = countedSides(record, name, cause, isMovedKey);
  const byCounter = (side: CounterSide | undefined) =>
    side === undefined ? undefined : () => hasCounterWritten(record, name, side);
  return [
    { target: current, isWrittenByCounter: byCounter(sides.current) },
    { target: stored, isWrittenByCounter: byCounter(sides.stored) },
  ].filter((each): each is TouchedRecord => isTouchable(each.target, claimed));
}

/** Whether a saved record's belongsTo `name` points elsewhere than its row does. */
function isMoved(record: Model, name: string): boolean {
  const recordState = record[state];
  if (recordState.isNew) return false;
  const definition = associationOf(modelOf(record), name);
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
  const query = branch.all(recordState.executor).findBy({ [branch.targetAttribute]: key });
  return (await query) as Model | null;
}

/**
 * A record with a row to touch once the write is sent: one that's saved and isn't destroyed, or
 * a new one the write inserts itself, which Rails touches after its insert too.
 */
function isTouchable(record: unknown, claimed: ReadonlySet<Model>): record is Model {
  if (!(record instanceof Model)) return false;
  const recordState = record[state];
  if (recordState.isNew) return claimed.has(record);
  return !recordState.isDestroyed;
}

/**
 * `target`'s touch write, setting what `touch` names (in its counter's UPDATE, when counted),
 * then those it makes in turn; nothing if this write has touched it already.
 */
async function touchOne(
  target: Model,
  { touch, isWrittenByCounter }: TouchWriteOptions & { touch: unknown },
  claimed: ReadonlySet<Model>,
): Promise<PreparedWrite[]> {
  const session = sessionOf(claimed);
  const model = modelOf(target);
  const key = touchKey(target);
  if (session.touched.has(key)) return [];
  session.touched.add(key);
  const values = Object.fromEntries(touchAssignments(model, touch, "touch", session.time));
  const write = touchWrite(target, values, {
    isWrittenByCounter,
    keepsSavedChanges: () => isClaimedRow(target, claimed),
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
 * (another instance may be the one claimed): a row the write destroys takes nothing and runs no
 * touch callback (Rails touches only a persisted record), and a row the write saves itself runs
 * its commit and rollback callbacks once, from its own save.
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
    afterRollback: async () => {
      if (!isClaimedRow(target, claimed)) await write.afterRollback?.();
    },
  };
}
