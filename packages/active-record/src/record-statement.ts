// RecordStatement: a record's save or destroy, prepared for `db.batch`.
import type { Model } from "./model.ts";
import type { ValidationContexts } from "./validation-context.ts";

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
  readonly #context: ValidationContexts | undefined;

  /** @internal Use a Batch's `save` or `destroy`. */
  constructor(record: R, kind: "save" | "destroy", context?: ValidationContexts) {
    this.#record = record;
    this.#kind = kind;
    this.#context = context;
  }

  /**
   * @internal What `db.batch` needs: the record, whether it's saved or destroyed, and the
   * validation context a save validates it in, if given (#420).
   */
  get [recordStatementParts](): {
    record: R;
    kind: "save" | "destroy";
    context: ValidationContexts | undefined;
  } {
    return { record: this.#record, kind: this.#kind, context: this.#context };
  }
}
