// The `Database` that `connect` returns: `db.model()`, sessions, and `db.batch`.
import { NoSession } from "./errors.ts";
import { runBatch, type BatchEntry, type BatchResults } from "./batch.ts";
import { D1Driver } from "./d1/driver.ts";
import { DatabaseExecutor, type QueryListener } from "./executor.ts";
import type { Model, ModelClass, ScopesOf } from "./model.ts";
import type { Scoped } from "./relation.ts";
import { relationFor } from "./scoped-relation.ts";

/** One request-bound Relation per Model, keyed like the object passed to `db.models()`. */
export type RelationsFor<T extends Record<string, ModelClass<Model>>> = {
  [K in keyof T]: Scoped<InstanceType<T[K]>, ScopesOf<T[K]>>;
};

export interface ConnectOptions {
  /** Called once for every statement sent to D1. */
  onQuery?: QueryListener;
  /**
   * Sends every query through one D1 Session, so the request reads its own writes even when
   * reads are served by replicas: `"first-primary"`, `"first-unconstrained"`, or a bookmark
   * from an earlier request's `db.bookmark()`.
   */
  // `& {}` keeps the two constraint names suggested alongside any bookmark string.
  session?: D1SessionConstraint | (D1SessionBookmark & {});
}

/** @internal The library's key for a Database's D1 binding and Executor (the current database, #77). */
export const databaseParts = Symbol("databaseParts");

/** A per-request wrapper around a D1 binding; every query goes through it. */
export class Database {
  readonly #binding: D1Database;
  readonly #driver: D1Driver;
  readonly #executor: DatabaseExecutor;
  constructor(binding: D1Database, options: ConnectOptions = {}) {
    const { session, onQuery } = options;
    this.#binding = binding;
    this.#driver = new D1Driver(session === undefined ? binding : binding.withSession(session));
    this.#executor = new DatabaseExecutor(this.#driver, onQuery);
  }

  /** @internal Its D1 binding (not its Session), to match Models' bindings, and what sends for it. */
  get [databaseParts](): { binding: D1Database; driver: D1Driver; executor: DatabaseExecutor } {
    return { binding: this.#binding, driver: this.#driver, executor: this.#executor };
  }

  /**
   * The Session's latest bookmark (null before its first query). Pass it to the next request's
   * `connect(env.DB, { session: bookmark })` to read at least as new as this request wrote.
   */
  bookmark(): D1SessionBookmark | null {
    // Its Session now, which may have started again (#237).
    const { session } = this.#driver;
    if (session === undefined) {
      throw new NoSession(
        "bookmark() needs a Database opened with a session: connect(env.DB, { session })",
      );
    }
    return session.getBookmark();
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
   * Runs statements and record statements atomically, with D1's `batch()`: all of them are
   * written, or none. Record statements (`user.toSave()`, `post.toDestroy()`) run
   * their validations and before-callbacks first, in order; the first record that's invalid or
   * aborts throws (`RecordInvalid`, `RecordNotSaved`, `RecordNotDestroyed`) and nothing is sent.
   * After the batch, each record takes its saved state and runs its after-callbacks, in order.
   * Resolves to each entry's result: D1's `meta` for a statement, the record for a record
   * statement. There's no interactive `transaction()`, because D1 can't hold one open across
   * awaits.
   */
  async batch<const T extends readonly BatchEntry[]>(entries: T): Promise<BatchResults<T>> {
    // Every entry on this Database: built on it, or on the current one when it's this.
    return runBatch(entries, "db.batch() needs its statements and records", [this.#executor]);
  }
}

export function connect(binding: D1Database, options?: ConnectOptions): Database {
  return new Database(binding, options);
}

/**
 * @internal A request's Database, for `withSession`: its Session starts from the bookmark the
 * request carries, or `start` when it has none. A request's bookmark may be forged, so one D1
 * rejects starts the Session again from `start` (#237); a bookmark given to `connect` throws.
 */
export function connectForRequest(
  binding: D1Database,
  bookmark: string | undefined,
  start: D1SessionConstraint,
  options: Omit<ConnectOptions, "session">,
): Database {
  const db = new Database(binding, { ...options, session: bookmark ?? start });
  if (bookmark !== undefined) {
    db[databaseParts].driver.whenBookmarkRejected(() => binding.withSession(start));
  }
  return db;
}
