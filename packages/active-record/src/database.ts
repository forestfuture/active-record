// A `Database`, on any adapter: `db.model()` and `db.batch`.
import { runBatch, type BatchEntry, type BatchResults } from "./batch.ts";
import { Batch } from "./batch-builder.ts";
import type { DatabaseExecutor } from "./executor.ts";
import type { Model, ModelClass, ScopesOf } from "./model.ts";
import type { Scoped } from "./relation.ts";
import { relationFor } from "./scoped-relation.ts";

/** One request-bound Relation per Model, keyed like the object passed to `db.models()`. */
export type RelationsFor<T extends Record<string, ModelClass<Model>>> = {
  [K in keyof T]: Scoped<InstanceType<T[K]>, ScopesOf<T[K]>>;
};

/** The key for a Database's Executor (the current database, #77), for adapters (`/adapter`). */
export const databaseExecutor = Symbol("databaseExecutor");

/** A per-request handle on a database; every query goes through it. */
export class AnyDatabase {
  readonly #executor: DatabaseExecutor;

  /** @internal Built by an adapter, through its own `connect`. */
  constructor(executor: DatabaseExecutor) {
    this.#executor = executor;
  }

  /** @internal Its Executor. */
  get [databaseExecutor](): DatabaseExecutor {
    return this.#executor;
  }

  /** A request-bound Relation over the Model's records, with its scopes as methods. */
  model<C extends ModelClass<Model>>(model: C): Scoped<InstanceType<C>, ScopesOf<C>> {
    return relationFor(this.#executor, model);
  }

  /** Request-bound relations for several models at once: `db.models({ User }).User`. */
  models<const T extends Record<string, ModelClass<Model>>>(models: T): RelationsFor<T> {
    // Each entry is exactly db.model(thatModel), so it has that Model's Relation type.
    return Object.fromEntries(
      Object.entries(models).map(([name, model]) => [name, this.model(model)]),
    ) as unknown as RelationsFor<T>;
  }

  /**
   * Runs statements and record statements atomically: all of them are written, or none. Record
   * statements (`user.toSave()`, `post.toDestroy()`) run their validations and before-callbacks
   * first, in order; the first record that's invalid or
   * aborts throws (`RecordInvalid`, `RecordNotSaved`, `RecordNotDestroyed`) and nothing is sent.
   * After the batch, each record takes its saved state and runs its after-callbacks, in order.
   * Resolves to each entry's result: a statement's `{ rowsAffected, rows }`, the record for a
   * record statement.
   */
  async batch<const T extends readonly BatchEntry[]>(
    entries: T | ((b: Batch) => T),
  ): Promise<BatchResults<T>> {
    const listed =
      typeof entries === "function"
        ? entries(new Batch((model) => relationFor(this.#executor, model)))
        : entries;
    // Every entry on this Database: built on it, or on the current one when it's this.
    return runBatch(listed, "db.batch() needs its statements and records", [this.#executor]);
  }
}
