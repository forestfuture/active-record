// Read-only records (#358): refusing a read-only record's writes before anything runs or is sent.
import { ReadonlyRecord, type ReadonlyAction } from "./errors.ts";
import type { Model } from "./model.ts";
import { state } from "./record-state.ts";

/** Refuses `action` on a read-only record, before its validation, callbacks or statements. */
export function requireWritable(record: Model, action: ReadonlyAction): void {
  if (record[state].isReadonly) throw new ReadonlyRecord(record, action);
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
