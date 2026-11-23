// Read-only records and attributes (#358): refusing a read-only record's writes, and a save that
// changes a read-only attribute, before anything runs or is sent.
import { ReadonlyAttribute, ReadonlyRecord, type ReadonlyAction } from "./errors.ts";
import type { Model, ModelClass } from "./model.ts";
import { state } from "./record-state.ts";

/**
 * Refuses `action` on a read-only record, before its validation, callbacks or statements; and a
 * save of a persisted record whose read-only attribute changed without being assigned, in place.
 */
export function requireWritable(record: Model, action: ReadonlyAction): void {
  if (record[state].isReadonly) throw new ReadonlyRecord(record, action);
  if (action === "save") requireReadonlyAttributesKept(record);
}

/** Refuses a write straight to a row that sets a read-only attribute, `names`, before it's sent. */
export function requireWritableColumns(model: ModelClass, names: Iterable<string>): void {
  for (const name of names) {
    if (model.attributeDefinitions.get(name)?.readonly === true) {
      throw new ReadonlyAttribute(model.name, name);
    }
  }
}

/** A persisted record's read-only attributes, as it was loaded or created, or `ReadonlyAttribute`. */
function requireReadonlyAttributesKept(record: Model): void {
  const recordState = record[state];
  if (!recordState.isPersisted) return;
  requireWritableColumns(record.constructor as ModelClass, recordState.changedNames());
}

/**
 * Refuses a save that would write a read-only record through its owner's associations: saving or
 * destroying one marked for destruction. Checked before the owner's validation and callbacks.
 */
export function requireSavesWritable(records: readonly Model[]): void {
  for (const record of records) {
    requireWritable(record, record[state].isMarkedForDestruction ? "destroy" : "save");
  }
}
