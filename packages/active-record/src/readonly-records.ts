// Read-only records (#358): `markReadonly()` and `isReadonly()`, between Model and its column writes so
// model.ts stays the record class's own, and refusing a read-only record's writes before anything
// runs or is sent.
import { AttributeWrites } from "./attribute-writes.ts";
import { ReadonlyRecord, type ReadonlyAction } from "./errors.ts";
import type { Model } from "./model.ts";
import { state } from "./record-state.ts";

/** The read-only mark Model's records have. */
export abstract class ReadonlyMarks extends AttributeWrites {
  /**
   * Marks the record read-only: saving, destroying, touching it or writing its columns throws
   * `ReadonlyRecord`, sending nothing. It can still be changed in memory and reloaded.
   */
  markReadonly<R extends Model>(this: R): R {
    this[state].isReadonly = true;
    return this;
  }

  /** Whether it's read-only: marked by `markReadonly()`, or loaded through a `readonly()` Relation. */
  isReadonly(this: Model): boolean {
    return this[state].isReadonly;
  }
}

/** Refuses `action` on a read-only record, before its validation, callbacks or statements. */
export function requireWritable(record: Model, action: ReadonlyAction): void {
  if (record[state].isReadonly) throw new ReadonlyRecord(record, action);
}
