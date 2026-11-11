// Batch: what `batch((b) => [...])` hands its callback, to prepare each write the batch runs.
import type { AttributesOf, Model, ModelClass } from "./model.ts";
import { preparedWrites } from "./prepared-writes.ts";
import { RecordStatement } from "./record-statement.ts";
import { Relation } from "./relation.ts";
import type { InsertOptions, Returning, UpsertOptions } from "./relation-checks.ts";
import type { SafeSql } from "./sql.ts";
import type { ReturnedRow, Statement } from "./statement.ts";

/** The library's key for closing a Batch once its callback has returned. */
const closeBatch = Symbol("closeBatch");

/** What a Batch writes to: a Model's table, or a Relation's rows (`Post.where(…)`, `user.posts()`). */
export type BatchTarget<M extends Model> = ModelClass<M> | Relation<M>;

/**
 * The writes of one batch, prepared inside its callback: `b.insert(Author, { name })`. Each is
 * written when the batch runs, atomically with the rest, and none is sent on its own.
 */
export class Batch {
  readonly #relationOf: RelationOf;
  #open = true;

  /** @internal Built by `batch()` and `db.batch()`, which look up a Model's rows with `relationOf`. */
  constructor(relationOf: RelationOf) {
    this.#relationOf = relationOf;
  }

  /** @internal Called once its callback has returned, so a write prepared later can't be lost. */
  [closeBatch](): void {
    this.#open = false;
  }

  /**
   * Saves `record`, its autosaved associations included. Its validations and before-callbacks
   * run when the batch runs, before anything is written, and its after-callbacks once it is.
   */
  save<R extends Model>(record: R): RecordStatement<R> {
    this.#requireOpen();
    return new RecordStatement(record, "save");
  }

  /** Destroys `record`, with its dependents, its callbacks running as `save`'s do. */
  destroy<R extends Model>(record: R): RecordStatement<R> {
    this.#requireOpen();
    return new RecordStatement(record, "destroy");
  }

  /** Inserts one row, as `insert` does when it runs alone. */
  insert<M extends Model, const R extends Returning<M> | undefined = undefined>(
    target: BatchTarget<M>,
    attributes: Partial<AttributesOf<M>>,
    options: InsertOptions<M> & { returning?: R } = {},
  ): Statement<ReturnedRow<M, R>> {
    return this.#rows(target)[preparedWrites].insert(attributes, options);
  }

  /** Inserts several rows with the same attributes, in one statement, as `insertAll` does. */
  insertAll<M extends Model, const R extends Returning<M> | undefined = undefined>(
    target: BatchTarget<M>,
    rows: readonly Partial<AttributesOf<M>>[],
    options: InsertOptions<M> & { returning?: R } = {},
  ): Statement<ReturnedRow<M, R>> {
    return this.#rows(target)[preparedWrites].insertAll(rows, options);
  }

  /** Inserts a row, or updates the one it clashes with, as `upsert` does. */
  upsert<M extends Model, const R extends Returning<M> | undefined = undefined>(
    target: BatchTarget<M>,
    attributes: Partial<AttributesOf<M>>,
    options: UpsertOptions<M> & { returning?: R } = {},
  ): Statement<ReturnedRow<M, R>> {
    return this.#rows(target)[preparedWrites].upsert(attributes, options);
  }

  /** `upsert` for several rows with the same attributes, as `upsertAll` does. */
  upsertAll<M extends Model, const R extends Returning<M> | undefined = undefined>(
    target: BatchTarget<M>,
    rows: readonly Partial<AttributesOf<M>>[],
    options: UpsertOptions<M> & { returning?: R } = {},
  ): Statement<ReturnedRow<M, R>> {
    return this.#rows(target)[preparedWrites].upsertAll(rows, options);
  }

  /** Updates every row `target` matches, as `updateAll` does: `b.updateAll(Post, { published: true })`. */
  updateAll<M extends Model>(
    target: BatchTarget<M>,
    changes: Partial<AttributesOf<M>> | SafeSql,
  ): Statement {
    return this.#rows(target)[preparedWrites].updateAll(changes);
  }

  /** Deletes every row `target` matches, as `deleteAll` does (through a hasMany, it may nullify). */
  deleteAll<M extends Model>(target: BatchTarget<M>): Statement {
    return this.#rows(target)[preparedWrites].deleteAll();
  }

  /** The Relation a write goes through: `target` itself, or all of a Model's rows. */
  #rows<M extends Model>(target: BatchTarget<M>): Relation<M> {
    this.#requireOpen();
    if (target instanceof Relation) return target;
    return this.#relationOf(target) as unknown as Relation<M>;
  }

  #requireOpen(): void {
    if (!this.#open) {
      throw new TypeError("This Batch's callback has returned: prepare each write inside it");
    }
  }
}

/** How a Batch finds a Model's rows: on the batch's database. */
type RelationOf = (model: ModelClass) => Relation<Model>;

/**
 * The entries `build` returns for a batch, given a Batch that closes once it has returned. A
 * callback can't await (D1 can't hold a batch open across one), so it must return an array.
 */
export function batchEntries<T>(build: (b: Batch) => T, relationOf: RelationOf): T {
  const b = new Batch(relationOf);
  let entries: T;
  try {
    entries = build(b);
  } finally {
    b[closeBatch]();
  }
  if (!Array.isArray(entries)) {
    // An async callback may still prepare a write on the closed Batch; that rejection is this one.
    if (isThenable(entries)) entries.then(undefined, () => {});
    throw new TypeError(
      "A batch's callback must return its writes in an array, without awaiting anything: " +
        "a batch is sent as one, so it can't wait for a read",
    );
  }
  return entries;
}

/** Whether `value` is a Promise or another thenable, as an async callback returns. */
function isThenable(value: unknown): value is PromiseLike<unknown> {
  return typeof (value as { then?: unknown } | null)?.then === "function";
}
