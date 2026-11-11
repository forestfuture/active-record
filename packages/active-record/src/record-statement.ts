// RecordStatement: a record's save or destroy, prepared for `db.batch`.
import type { Model } from "./model.ts";

declare const recordType: unique symbol;

/** @internal The library's key for what `db.batch` needs from a RecordStatement. */
export const recordStatementParts = Symbol("recordStatementParts");

/**
 * A record's save or destroy in a batch: `b.save(user)`, `b.destroy(post)`. Unlike a
 * Statement, nothing is compiled yet: the record's validations and callbacks run when the batch
 * runs. It has no `then`, so it's never run by being awaited.
 */
export class RecordStatement<R extends Model = Model> {
  /** Type-only: the record's type, so a statement of one Model isn't taken for another's. */
  declare readonly [recordType]?: R;

  readonly #record: R;
  readonly #kind: "save" | "destroy";

  /** @internal Use a Batch's `save` or `destroy`. */
  constructor(record: R, kind: "save" | "destroy") {
    this.#record = record;
    this.#kind = kind;
  }

  /** @internal What `db.batch` needs: the record, and whether it's saved or destroyed. */
  get [recordStatementParts](): { record: R; kind: "save" | "destroy" } {
    return { record: this.#record, kind: this.#kind };
  }
}
