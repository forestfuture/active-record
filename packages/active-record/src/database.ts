// A `Database`, on any adapter: `db.model()` and `db.batch`.
import { runBatch, type BatchEntry, type BatchResults } from "./batch.ts";
import { batchEntries, type Batch } from "./batch-builder.ts";
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
   * Runs the writes `build` prepares atomically, on this Database: all of them are written, or
   * none. `db.batch((b) => [b.insert(Post, { title }), b.save(user)])`. The callback can't await,
   * since the batch is sent as one. Saves and destroys (`b.save(user)`, `b.destroy(post)`) run
   * their validations and before-callbacks first, in order; the first record that's invalid or
   * aborts throws (`RecordInvalid`, `RecordNotSaved`, `RecordNotDestroyed`) and nothing is sent.
   * After the batch, each record takes its saved state and runs its after-callbacks, in order.
   * Resolves to each write's result: a bulk write's `{ rowsAffected, rows }`, or the record.
   */
  async batch<const T extends readonly BatchEntry[]>(
    build: (b: Batch) => T,
  ): Promise<BatchResults<T>> {
    const entries = batchEntries(build, (model) => relationFor(this.#executor, model));
    // Every entry on this Database: built on it, or on the current one when it's this.
    return runBatch(entries, "db.batch() needs its statements and records", [this.#executor]);
  }
}
