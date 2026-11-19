// Touching a record (#50): `touch()`, its timestamps set to now, or a given time, in one UPDATE by its stored key, with no validation or save callback, then `afterTouch`.
import { runAfterCallbacks } from "./callbacks.ts";
import { compileUpdate } from "./compiler.ts";
import { touchAssignments } from "./counters.ts";
import type { Model, ModelClass } from "./model.ts";
import { state } from "./record-state.ts";

/** What `touch` and `touchAll` take after the attributes they name: the `time` to set. */
export interface TouchOptions {
  /** The time to set, now by default. */
  time?: Date;
}

/** `touch`'s arguments: datetime attributes' names, optionally followed by its options. */
export type TouchArguments<K> = K[] | [...K[], TouchOptions];

/** The names in `touch`'s arguments, and the options after them. */
export function splitTouchArguments(args: readonly unknown[]): {
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
 * the row, and holds them, clean; then runs `afterTouch`. Resolves to whether there was a row to write.
 */
export async function touchRecord(record: Model, args: readonly unknown[]): Promise<boolean> {
  const recordState = record[state];
  const model = record.constructor as ModelClass;
  const { names, options } = splitTouchArguments(args);
  const touched = touchAssignments(model, names.length === 0 ? true : names, "touch", options.time);
  if (touched.length === 0) {
    throw new TypeError(
      `${model.name}.touch has nothing to touch: ${model.name} has no updatedAt; ` +
        "name a datetime attribute",
    );
  }
  recordState.assign(Object.fromEntries(touched));
  const assignments = touched.map(([name]): [string, unknown] => [name, recordState.read(name)]);
  const update = compileUpdate(model, assignments, recordState.storedKey);
  const [result] = await recordState.executor.write([update]);
  recordState.commitColumns(touched.map(([name]) => name));
  await runAfterCallbacks(record, "afterTouch", "touch");
  return result?.rowsAffected === 1;
}
