// Touching a record (#50): `touch()`, its timestamps set to now, or a given time, in one UPDATE by its stored key, with no validation or save callback, then `afterTouch` and the update commit callbacks, with the records its belongsTos (#353) and hasOnes (#497) touch; the touch write other writes make; and what a Relation's `touchAll` sets.
import type { DatetimeAttributeKey } from "./attribute-writes.ts";
import { afterRollbackOf, runAfterCallbacks, runCommitCallbacks } from "./callbacks.ts";
import { attributeFor } from "./attribute.ts";
import { compileUpdate } from "./compiler.ts";
import { touchesOfTouch } from "./association-touch.ts";
import { touchAssignments } from "./counters.ts";
import { modelOf, type Model, type ModelClass } from "./model.ts";
import { isCoveredByNoTouching } from "./no-touching.ts";
import { lockOf, type Lock } from "./optimistic-locking.ts";
import { state } from "./record-state.ts";
import { runAfter, writeAll, type PreparedWrite } from "./unit-of-work.ts";

/** What `touch` and `touchAll` take after the attributes they name: the `time` to set. */
export interface TouchOptions {
  /** The time to set, now by default. */
  time?: Date;
}

/** `touch`'s arguments on record type `R`: its datetime attributes' names, then its options. */
export type TouchArguments<R> =
  | DatetimeAttributeKey<R>[]
  | [...DatetimeAttributeKey<R>[], TouchOptions];

/**
 * What `touch(...args)` or `touchAll(...args)` sets: `updatedAt`, and the datetime attributes
 * named, each to now or `time`. Nothing to set (no `updatedAt`, no names) is a `TypeError`.
 */
export function touchValues(
  model: ModelClass,
  args: readonly unknown[],
  method: "touch" | "touchAll",
): Record<string, unknown> {
  const { names, options } = splitTouchArguments(args, `${model.name}.${method}`);
  const touched = touchAssignments(model, names.length === 0 ? true : names, method, options.time);
  if (touched.length === 0) {
    throw new TypeError(
      `${model.name}.${method} has nothing to touch: ${model.name} has no updatedAt; ` +
        "name a datetime attribute",
    );
  }
  return Object.fromEntries(touched);
}

/**
 * The names in `touch`'s arguments, and the options after them, checked as untyped code could
 * pass a Date for `{ time }`, or a misspelled option, which would touch at now unnoticed.
 */
function splitTouchArguments(
  args: readonly unknown[],
  method: string,
): { names: unknown[]; options: TouchOptions } {
  const last = args.at(-1);
  if (last instanceof Date) throw new TypeError(`${method} takes a time as { time }; got a Date`);
  if (typeof last !== "object" || last === null) return { names: [...args], options: {} };
  const unknown = Object.keys(last).filter((key) => key !== "time");
  if (unknown.length > 0)
    throw new TypeError(`${method} takes { time }; got ${unknown.join(", ")}`);
  return { names: args.slice(0, -1), options: last as TouchOptions };
}

/**
 * Sets the record's `updatedAt`, and the datetime attributes named, to now or `time`, straight to
 * the row, and holds them, clean; then runs `afterTouch`, and the update commit callbacks when a
 * row was written. Resolves to whether there was a row to write: none
 * inside a `noTouching` block that covers its Model, which sends nothing and runs no callback.
 */
export async function touchRecord(record: Model, args: readonly unknown[]): Promise<boolean> {
  const model = modelOf(record);
  const values = touchValues(model, args, "touch");
  if (isCoveredByNoTouching(model)) return false;
  // Every value is the one time the touch sets.
  const time = Object.values(values)[0] as Date;
  // A locked record's touch matches only its version, and sets the next (#357).
  const lock = lockOf(record, "touch");
  const writes = [
    touchWrite(record, () => values, { lock }),
    ...(await touchesOfTouch(record, time)),
  ];
  const [result] = await writeAll(record[state].executor, writes);
  await runAfter(writes);
  return result?.rowsAffected === 1;
}

/**
 * The key a touch's UPDATE finds its record's row by: the stored key, or, for a new record the
 * same batch inserts first (#353), the key it's given.
 */
function keyCells(record: Model): unknown {
  const recordState = record[state];
  if (!recordState.isNew) return recordState.storedKey;
  const { primaryKey } = modelOf(record);
  return attributeFor(modelOf(record), primaryKey).store(recordState.read(primaryKey));
}

/** How a touch write differs when another write makes it (#353). */
export interface TouchWriteOptions {
  /**
   * Whether the record keeps its `savedChanges`, asked as the touch commits: a record the same
   * write saves itself keeps its save's, for its own callbacks.
   */
  keepsSavedChanges?: () => boolean;
  /** The lock a record's own `touch()` checks, and whose next version it sets (#357). */
  lock?: Lock | undefined;
}

/**
 * The touch's write: the values `valuesOf` gives, asked as it's sent, then assigned and held clean
 * once the row has them. The record changes only then, so a refused touch leaves it as it was,
 * and runs `afterRollback`.
 */
export function touchWrite(
  record: Model,
  valuesOf: () => Record<string, unknown>,
  { keepsSavedChanges, lock }: TouchWriteOptions = {},
): PreparedWrite {
  const recordState = record[state];
  const model = modelOf(record);
  const assigned = () => ({ ...valuesOf(), ...(lock && Object.fromEntries([lock.next])) });
  let isWritten = false;
  return {
    // Compiled as it's sent: a record the same write inserts has its key by then.
    get statements() {
      const update = compileUpdate(model, Object.entries(assigned()), keyCells(record));
      return lock?.guarded(update) ?? [update];
    },
    commit: ([result]) => {
      const values = assigned();
      recordState.assign(values);
      if (keepsSavedChanges?.()) recordState.commitColumns(Object.keys(values));
      else recordState.commitTouch(Object.keys(values));
      isWritten = result?.rowsAffected === 1;
    },
    after: () => runAfterCallbacks(record, "afterTouch", "touch"),
    afterCommit: async () => {
      if (isWritten) await runCommitCallbacks(record, "update");
    },
    afterRollback: afterRollbackOf(record),
    ...(lock && { failed: lock.failed }),
  };
}
