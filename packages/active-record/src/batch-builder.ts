// Batch: what `batch((b) => [...])` hands its callback, to prepare each write the batch runs.
import type { AttributesOf, Model, ModelClass } from "./model.ts";
import { Relation } from "./relation.ts";
import type { InsertOptions, Returning, UpsertOptions } from "./relation-checks.ts";
import type { SafeSql } from "./sql.ts";
import type { ReturnedRow, Statement } from "./statement.ts";

/** What a Batch writes to: a Model's table, or a Relation's rows (`Post.where(…)`, `user.posts()`). */
export type BatchTarget<M extends Model> = ModelClass<M> | Relation<M>;

/**
 * The writes of one batch, prepared inside its callback: `b.insert(Author, { name })`. Each is
 * written when the batch runs, atomically with the rest, and none is sent on its own.
 */
export class Batch {
  readonly #relationOf: (model: ModelClass) => Relation<Model>;

  /** @internal Built by `batch()` and `db.batch()`, which look up a Model's rows with `relationOf`. */
  constructor(relationOf: (model: ModelClass) => Relation<Model>) {
    this.#relationOf = relationOf;
  }

  /** Inserts one row, as `insert` does when it runs alone. */
  insert<M extends Model, const R extends Returning<M> | undefined = undefined>(
    target: BatchTarget<M>,
    attributes: Partial<AttributesOf<M>>,
    options: InsertOptions<M> & { returning?: R } = {},
  ): Statement<ReturnedRow<M, R>> {
    return this.#rows(target).toInsert(attributes, options);
  }

  /** Inserts several rows with the same attributes, in one statement, as `insertAll` does. */
  insertAll<M extends Model, const R extends Returning<M> | undefined = undefined>(
    target: BatchTarget<M>,
    rows: readonly Partial<AttributesOf<M>>[],
    options: InsertOptions<M> & { returning?: R } = {},
  ): Statement<ReturnedRow<M, R>> {
    return this.#rows(target).toInsertAll(rows, options);
  }

  /** Inserts a row, or updates the one it clashes with, as `upsert` does. */
  upsert<M extends Model, const R extends Returning<M> | undefined = undefined>(
    target: BatchTarget<M>,
    attributes: Partial<AttributesOf<M>>,
    options: UpsertOptions<M> & { returning?: R } = {},
  ): Statement<ReturnedRow<M, R>> {
    return this.#rows(target).toUpsert(attributes, options);
  }

  /** `upsert` for several rows with the same attributes, as `upsertAll` does. */
  upsertAll<M extends Model, const R extends Returning<M> | undefined = undefined>(
    target: BatchTarget<M>,
    rows: readonly Partial<AttributesOf<M>>[],
    options: UpsertOptions<M> & { returning?: R } = {},
  ): Statement<ReturnedRow<M, R>> {
    return this.#rows(target).toUpsertAll(rows, options);
  }

  /** Updates every row `target` matches, as `updateAll` does: `b.updateAll(Post, { published: true })`. */
  updateAll<M extends Model>(
    target: BatchTarget<M>,
    changes: Partial<AttributesOf<M>> | SafeSql,
  ): Statement {
    return this.#rows(target).toUpdateAll(changes);
  }

  /** Deletes every row `target` matches, as `deleteAll` does (through a hasMany, it may nullify). */
  deleteAll<M extends Model>(target: BatchTarget<M>): Statement {
    return this.#rows(target).toDeleteAll();
  }

  /** The Relation a write goes through: `target` itself, or all of a Model's rows. */
  #rows<M extends Model>(target: BatchTarget<M>): Relation<M> {
    if (target instanceof Relation) return target;
    return this.#relationOf(target) as unknown as Relation<M>;
  }
}
