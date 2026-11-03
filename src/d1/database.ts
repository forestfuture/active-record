// The `Database` that `connect` returns: a D1 binding, with its sessions and bookmarks.
import { AnyDatabase } from "../database.ts";
import { NoSession } from "../errors.ts";
import {
  DatabaseExecutor,
  type QueryEvent as AnyQueryEvent,
  type QueryListener as AnyQueryListener,
} from "../executor.ts";
import { d1Adapter } from "./adapter.ts";
import { d1Parts } from "./current-binding.ts";
import { D1Driver } from "./driver.ts";

/** What `onQuery` hears about a statement: its Model, SQL, bound values, timing, and D1's `meta`. */
export type QueryEvent<Meta = D1Meta> = AnyQueryEvent<Meta>;

/** Hears each statement's `QueryEvent`, with D1's `meta`. */
export type QueryListener<Meta = D1Meta> = AnyQueryListener<Meta>;

export interface ConnectOptions {
  /** Called once for every statement sent to D1, with D1's `meta`. */
  onQuery?: QueryListener<D1Meta>;
  /**
   * Sends every query through one D1 Session, so the request reads its own writes even when
   * reads are served by replicas: `"first-primary"`, `"first-unconstrained"`, or a bookmark
   * from an earlier request's `db.bookmark()`.
   */
  // `& {}` keeps the two constraint names suggested alongside any bookmark string.
  session?: D1SessionConstraint | (D1SessionBookmark & {});
}

/**
 * A per-request wrapper around a D1 binding; every query goes through it. `db.batch` uses D1's
 * `batch()`. There's no interactive `transaction()`, because D1 can't hold one open across awaits.
 */
export class Database extends AnyDatabase {
  readonly #binding: D1Database;
  readonly #driver: D1Driver;

  constructor(binding: D1Database, options: ConnectOptions = {}) {
    const { session, onQuery } = options;
    const driver = new D1Driver(session === undefined ? binding : binding.withSession(session));
    super(new DatabaseExecutor(d1Adapter, driver, onQuery));
    this.#binding = binding;
    this.#driver = driver;
  }

  /** @internal Its D1 binding (not its Session), to match Models' bindings, and its Driver. */
  get [d1Parts](): { binding: D1Database; driver: D1Driver } {
    return { binding: this.#binding, driver: this.#driver };
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
    db[d1Parts].driver.whenBookmarkRejected(() => binding.withSession(start));
  }
  return db;
}
