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
  const { names, options } = splitTouchArguments(args);
  const touched = touchAssignments(model, names.length === 0 ? true : names, method, options.time);
  if (touched.length === 0) {
    throw new TypeError(
      `${model.name}.${method} has nothing to touch: ${model.name} has no updatedAt; ` +
        "name a datetime attribute",
    );
  }
  return Object.fromEntries(touched);
}

/** The names in `touch`'s arguments, and the options after them. */
function splitTouchArguments(args: readonly unknown[]): {
  names: unknown[];
  options: TouchOptions;
} {
  const last = args.at(-1);
  if (typeof last === "object" && last !== null) {
    return { names: args.slice(0, -1), options: last as TouchOptions };
  }
  return { names: [...args], options: {} };
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
 * The touch's write: `values` assigned and sent, then held clean; or, if the database refuses it,
 * the values from before, and `afterRollback`.
 */
function touchWrite(record: Model, values: Record<string, unknown>): PreparedWrite {
  const recordState = record[state];
  const names = Object.keys(values);
  const before = Object.fromEntries(names.map((name) => [name, recordState.read(name)]));
  recordState.assign(values);
  const assignments = names.map((name): [string, unknown] => [name, recordState.read(name)]);
  let isWritten = false;
  return {
    statements: [
      compileUpdate(record.constructor as ModelClass, assignments, recordState.storedKey),
    ],
    commit: ([result]) => {
      recordState.commitColumns(names);
      isWritten = result?.rowsAffected === 1;
    },
    after: () => runAfterCallbacks(record, "afterTouch", "touch"),
    afterCommit: async () => {
      if (isWritten) await runCommitCallbacks(record, "update");
    },
    failed: () => {
      recordState.assign(before);
      return undefined;
    },
    afterRollback: afterRollbackOf(record),
  };
}
