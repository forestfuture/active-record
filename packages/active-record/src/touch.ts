// Touching a record (#50): `touch()`, its timestamps set to now, or a given time, in one UPDATE by its stored key, with no validation or save callback, then `afterTouch` and the update commit callbacks; and what a Relation's `touchAll` sets.
import type { DatetimeAttributeKey } from "./attribute-writes.ts";
import { afterRollbackOf, runAfterCallbacks, runCommitCallbacks } from "./callbacks.ts";
import { compileUpdate } from "./compiler.ts";
import { touchAssignments } from "./counters.ts";
import type { Model, ModelClass } from "./model.ts";
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
export function touchedValues(
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
 * row was written, as Rails' `touch` does. Resolves to whether there was a row to write.
 */
export async function touchRecord(record: Model, args: readonly unknown[]): Promise<boolean> {
  const write = touchWrite(record, touchedValues(record.constructor as ModelClass, args, "touch"));
  const [result] = await writeAll(record[state].executor, [write]);
  await runAfter([write]);
  return result?.rowsAffected === 1;
}

/**
 * The touch's write: `values` sent, then assigned and held clean once the row has them. The
 * record changes only then, so a refused touch leaves it as it was, and runs `afterRollback`.
 */
function touchWrite(record: Model, values: Record<string, unknown>): PreparedWrite {
  const recordState = record[state];
  const model = record.constructor as ModelClass;
  let isWritten = false;
  return {
    statements: [compileUpdate(model, Object.entries(values), recordState.storedKey)],
    commit: ([result]) => {
      recordState.assign(values);
      recordState.commitColumns(Object.keys(values));
      isWritten = result?.rowsAffected === 1;
    },
    after: () => runAfterCallbacks(record, "afterTouch", "touch"),
    afterCommit: async () => {
      if (isWritten) await runCommitCallbacks(record, "update");
    },
    afterRollback: afterRollbackOf(record),
  };
}
