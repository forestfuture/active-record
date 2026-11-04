// RecordStatement: a record's save or destroy, prepared for `db.batch`.
import type { Model } from "./model.ts";

declare const recordType: unique symbol;

/** @internal The library's key for what `db.batch` needs from a RecordStatement. */
export const recordStatementParts = Symbol("recordStatementParts");

/**
 * A record's save or destroy for `db.batch([...])`: `user.toSave()`,
 * `post.toDestroy()`. Unlike a Statement, nothing is compiled yet: the record's
 * validations and callbacks run when the batch runs. It has no `then`, so it's never run by
 * being awaited.
 */
export class RecordStatement<R extends Model = Model> {
  /** Type-only: the record's type, so a statement of one Model isn't taken for another's. */
  declare readonly [recordType]?: R;

  readonly #record: R;
  readonly #kind: "save" | "destroy";

  /** @internal Use `record.toSave()` or `record.toDestroy()`. */
  constructor(record: R, kind: "save" | "destroy") {
    this.#record = record;
    this.#kind = kind;
  }

  /**
   * @internal Hidden from the types so calling it doesn't compile. A Statement has `toSql()`;
   * this tells whoever calls it anyway, such as from JavaScript, why a record statement has none.
   */
  toSql(): never {
    throw new TypeError(
      "toSql() isn't available on a record's toSave() or toDestroy(): its SQL depends on validations and callbacks that only run inside db.batch",
    );
  }

  /** @internal What `db.batch` needs: the record, and whether it's saved or destroyed. */
  get [recordStatementParts](): { record: R; kind: "save" | "destroy" } {
    return { record: this.#record, kind: this.#kind };
  }
}
