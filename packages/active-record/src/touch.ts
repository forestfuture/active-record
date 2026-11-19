// Touching a record (#50): `touch()`, its timestamps set to now in one UPDATE by its stored key, with no validation or save callback.
import { compileUpdate } from "./compiler.ts";
import { touchAssignments } from "./counters.ts";
import type { Model, ModelClass } from "./model.ts";
import { state } from "./record-state.ts";

/**
 * Sets the record's `updatedAt`, and the datetime attributes `names`, to now, straight to the row,
 * and holds them, clean. Resolves to whether there was a row to write.
 */
export async function touchRecord(record: Model, names: readonly string[]): Promise<boolean> {
  const recordState = record[state];
  const model = record.constructor as ModelClass;
  const touched = touchAssignments(model, names.length === 0 ? true : names, "touch");
  recordState.assign(Object.fromEntries(touched));
  const update = compileUpdate(model, touched, recordState.storedKey);
  const [result] = await recordState.executor.write([update]);
  recordState.commitColumns(touched.map(([name]) => name));
  return result?.rowsAffected === 1;
}
