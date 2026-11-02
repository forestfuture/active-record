// The one place the library calls D1 (reporting each statement to `onQuery`, and starting a Session again when D1 rejects a request's bookmark), where a database is from, and the pinning of records to it.
import { boundValue, shownValue } from "./filtering.ts";
import type { CompiledSql } from "./compiler.ts";
import { translateConstraintError } from "./constraints.ts";
import { sqlite, type Dialect } from "./dialect.ts";
import { IncompatibleRelation, NoDatabase } from "./errors.ts";
import { explainMissingTable } from "./table-names.ts";

/**
 * Reported once for every statement sent to D1: to the database's `onQuery`, then to the
 * statement's Model's (`static onQuery`, usually on the app's base class).
 */
export interface QueryEvent {
  /**
   * The Model the statement is for: its class name (`"Product"`). It's `""` for an anonymous
   * class, and a bundler that renames classes changes it; Wrangler keeps names by default.
   */
  model: string;
  sql: string;
  params: unknown[];
  durationMs: number;
  meta?: D1Meta;
  error?: unknown;
}

export type QueryListener = (event: QueryEvent) => void;

/**
 * Workers' refusal of a D1 call outside a request (a query at a module's top level), as a
 * `NoDatabase` saying where queries belong; any other error, undefined.
 */
function outsideRequest(error: unknown): NoDatabase | undefined {
  const message = error instanceof Error ? error.message : String(error);
  if (!/within global scope/i.test(message)) return undefined;
  return new NoDatabase(
    "Queries run during a request: Workers don't allow D1 calls at a module's top level. Move " +
      "the query into your fetch handler, or a function it calls",
    { cause: error },
  );
}

/**
 * Calls a query listener, which never changes the query's outcome: a listener that throws is
 * logged, and the query's result or D1's error reaches the caller as it would have (#78).
 */
function notify(listener: QueryListener | undefined, event: QueryEvent): void {
  if (listener === undefined) return;
  try {
    listener(event);
  } catch (error) {
    console.error("onQuery threw; the query's result is unaffected:", error);
  }
}

/**
 * The concrete database a handle sends to now. Private to this module (#93): callers ask
 * `oneDatabase` (through `jointly` and `pinBefore`) instead, so "is this the same database?" is
 * decided in one place.
 */
const resolve = Symbol("resolve");

/** Where a Relation's or record's statements go: one database, or the current one (#77). */
export interface Executor {
  /** How its database writes the SQL the compiler can't share. */
  readonly dialect: Dialect;
  /** Runs one statement and resolves to its rows. */
  all(query: CompiledSql): Promise<Record<string, unknown>[]>;
  /** Runs one statement for its effect and resolves to D1's `meta`. */
  run(query: CompiledSql): Promise<D1Meta>;
  /** Runs statements atomically with D1's `batch()` and resolves to each one's result. */
  batch(statements: readonly CompiledSql[]): Promise<D1Result<Record<string, unknown>>[]>;
  /** Runs statements atomically: one on its own, several as one batch. */
  write(statements: readonly CompiledSql[]): Promise<D1Result<Record<string, unknown>>[]>;
  /** @internal The D1Executor that sends to D1 now: itself, or the current database's. */
  [resolve](): Promise<D1Executor>;
}

/** Where a database came from, for errors to name it: `connect()`'s, the request's, or a binding's. */
type Origin = "connect" | "request" | { binding: string };

/** How an error names a database by its origin. */
function nameOf(origin: Origin): string {
  if (origin === "connect") return "a connect() database";
  if (origin === "request") return "the request's database";
  return `the ${origin.binding} binding's database`;
}

/**
 * The single place the library calls D1: every statement is reported to `onQuery`, and a
 * constraint failure becomes the matching `ConstraintViolation` for the statement's Model.
 */
export class D1Executor implements Executor {
  readonly dialect = sqlite;
  #source: D1Database | D1DatabaseSession;
  /** Starts the Session again when D1 rejects the bookmark it started from (#237); once only. */
  #startAgain: (() => D1DatabaseSession) | undefined;
  readonly #onQuery: QueryListener | undefined;
  #origin: Origin = "connect";

  /** `binding` is the D1 binding itself, or one D1 Session every query goes through. */
  constructor(binding: D1Database | D1DatabaseSession, onQuery?: QueryListener) {
    this.#source = binding;
    this.#onQuery = onQuery;
  }

  async [resolve](): Promise<D1Executor> {
    return this;
  }

  /** @internal The D1 Session its statements go through now, if it has one. */
  get session(): D1DatabaseSession | undefined {
    return "getBookmark" in this.#source ? this.#source : undefined;
  }

  /**
   * @internal Arms a new Session for when D1 rejects the bookmark this one started from (a
   * request's, which may be forged): `startAgain` opens it, and the rejected statement is sent
   * again on it, since it never ran. Disarmed once a statement succeeds.
   */
  whenBookmarkRejected(startAgain: () => D1DatabaseSession): void {
    this.#startAgain = startAgain;
  }

  /** Where this database came from; errors name it by this. */
  get origin(): Origin {
    return this.#origin;
  }

  /**
   * @internal Sets where this database came from (#170): `withDatabase` makes it `"request"`, and
   * a binding's own Database takes `{ binding }`. It lives on the executor because records keep
   * their D1Executor and outlive `withDatabase`, so a per-request lookup couldn't find it later.
   * Sticky: a Database given to `withDatabase` is "the request's database" for its life, including
   * when it's used explicitly outside `withDatabase`.
   */
  setOrigin(origin: Origin): void {
    this.#origin = origin;
  }

  /** Runs one statement and resolves to its rows. */
  async all(query: CompiledSql): Promise<Record<string, unknown>[]> {
    return (await this.#one(query)).results;
  }

  /** Runs one statement for its effect and resolves to D1's `meta`. */
  async run(query: CompiledSql): Promise<D1Meta> {
    return (await this.#one(query)).meta;
  }

  /**
   * Runs statements atomically with D1's `batch()` and resolves to each one's result (rows and
   * `meta`). D1 fails a batch as a whole, so on failure every statement is reported with the error.
   */
  async batch(statements: readonly CompiledSql[]): Promise<D1Result<Record<string, unknown>>[]> {
    if (statements.length === 0) return [];
    return this.#startingAgainIfRejected(() => this.#batchOnce(statements));
  }

  async #batchOnce(
    statements: readonly CompiledSql[],
  ): Promise<D1Result<Record<string, unknown>>[]> {
    const started = performance.now();
    let results: D1Result<Record<string, unknown>>[];
    try {
      results = await this.#source.batch<Record<string, unknown>>(
        statements.map((statement) => this.#prepare(statement)),
      );
    } catch (error) {
      shortenBookmarkIn(error);
      const durationMs = performance.now() - started;
      for (const statement of statements) this.#report(statement, { durationMs, error });
      const models = statements.map(({ model }) => model);
      throw (
        outsideRequest(error) ??
        explainMissingTable(translateConstraintError(error, models), models)
      );
    }
    // D1 times each statement of a batch itself.
    statements.forEach((statement, index) => {
      const { meta } = results[index]!;
      this.#report(statement, { durationMs: meta.duration, meta });
    });
    return results;
  }

  /** Runs statements atomically: one on its own, several as one batch. Resolves to each result. */
  async write(statements: readonly CompiledSql[]): Promise<D1Result<Record<string, unknown>>[]> {
    const [only] = statements;
    if (statements.length === 1 && only !== undefined) return [await this.#one(only)];
    return this.batch(statements);
  }

  async #one(query: CompiledSql): Promise<D1Result<Record<string, unknown>>> {
    return this.#startingAgainIfRejected(() => this.#oneOnce(query));
  }

  /**
   * Sends statements with `send`, and again on a Session started anew when D1 rejects the bookmark
   * the first one started from. Statements sent at once all fail; each is sent again.
   */
  async #startingAgainIfRejected<T>(send: () => Promise<T>): Promise<T> {
    const source = this.#source;
    try {
      const sent = await send();
      // The bookmark was good: D1 rejects one on the Session's first statement only.
      this.#startAgain = undefined;
      return sent;
    } catch (error) {
      if (!isRejectedBookmark(error)) throw error;
      if (this.#source === source) {
        if (this.#startAgain === undefined) throw error;
        this.#source = this.#startAgain();
        this.#startAgain = undefined;
      }
      return send();
    }
  }

  async #oneOnce(query: CompiledSql): Promise<D1Result<Record<string, unknown>>> {
    const { model } = query;
    const started = performance.now();
    let result: D1Result<Record<string, unknown>>;
    try {
      result = await this.#prepare(query).all<Record<string, unknown>>();
    } catch (error) {
      shortenBookmarkIn(error);
      this.#report(query, { durationMs: performance.now() - started, error });
      throw (
        outsideRequest(error) ??
        explainMissingTable(translateConstraintError(error, [model]), [model])
      );
    }
    this.#report(query, { durationMs: performance.now() - started, meta: result.meta });
    return result;
  }

  /** Reports a statement to the database's listener, then to its Model's (`static onQuery`). */
  #report(
    { sql, params, model }: CompiledSql,
    outcome: Pick<QueryEvent, "durationMs" | "meta" | "error">,
  ): void {
    // A filtered attribute's values are "[FILTERED]" here; D1 got the real ones (#83).
    const event: QueryEvent = {
      model: model.name,
      sql,
      params: params.map(shownValue),
      ...outcome,
    };
    notify(this.#onQuery, event);
    notify(model.onQuery, event);
  }

  #prepare({ sql, params }: CompiledSql): D1PreparedStatement {
    return this.#source.prepare(sql).bind(...params.map(boundValue));
  }
}

/** D1's error for a Session's bookmark it can't use, and the bookmark it repeats (#237). */
const rejectedBookmark = /invalid commitToken bookmark provided: (.*)$/s;

/** Whether `error` is D1 rejecting the bookmark a Session started from. */
function isRejectedBookmark(error: unknown): boolean {
  return error instanceof Error && rejectedBookmark.test(error.message);
}

/** How much of a rejected bookmark D1's error keeps, since a request may have sent any length. */
const shownBookmarkLength = 64;

/** Cuts a long rejected bookmark short in `error`'s message, and its cause's (workerd's). */
function shortenBookmarkIn(error: unknown): void {
  if (!(error instanceof Error)) return;
  const bookmark = rejectedBookmark.exec(error.message)?.[1];
  if (bookmark === undefined || bookmark.length <= shownBookmarkLength) return;
  const short = `${bookmark.slice(0, shownBookmarkLength)}…`;
  error.message = error.message.replace(bookmark, short);
  if (error.cause instanceof Error)
    error.cause.message = error.cause.message.replace(bookmark, short);
}

/** An Executor that finds its D1Executor when a statement runs, and sends the statement there. */
abstract class ForwardingExecutor implements Executor {
  // Statements compile before their database is found, so this can't ask it. D1 is the only one.
  readonly dialect = sqlite;

  abstract [resolve](): Promise<D1Executor>;

  async all(query: CompiledSql): Promise<Record<string, unknown>[]> {
    return (await this[resolve]()).all(query);
  }

  async run(query: CompiledSql): Promise<D1Meta> {
    return (await this[resolve]()).run(query);
  }

  async batch(statements: readonly CompiledSql[]): Promise<D1Result<Record<string, unknown>>[]> {
    return (await this[resolve]()).batch(statements);
  }

  async write(statements: readonly CompiledSql[]): Promise<D1Result<Record<string, unknown>>[]> {
    return (await this[resolve]()).write(statements);
  }
}

/**
 * The current database's Executor (#77): finds the D1Executor to use each time a statement runs,
 * the request's or the binding's, so a Relation built from a Model's statics can be built anywhere.
 */
export class CurrentExecutor extends ForwardingExecutor {
  readonly #find: () => Promise<D1Executor>;

  constructor(find: () => Promise<D1Executor>) {
    super();
    this.#find = find;
  }

  [resolve](): Promise<D1Executor> {
    return this.#find();
  }
}

/** The D1Executor `handle` sends to now. */
export function databaseNow(handle: Executor): Promise<D1Executor> {
  return handle[resolve]();
}

/**
 * The one database these handles resolve to now: their D1Executor. Two databases throw
 * `IncompatibleRelation` (#93): "`needs` on one database", naming where each came from. Every
 * check of "the same database" (merge, or, scopes, batches, saves) and every pin goes here.
 */
async function oneDatabase(
  handles: readonly [Executor, ...Executor[]],
  needs: string,
): Promise<D1Executor> {
  const databases = [...new Set(await Promise.all(handles.map((handle) => handle[resolve]())))];
  const [first, second] = databases as [D1Executor, D1Executor | undefined];
  if (second !== undefined) {
    const [one, two] = [nameOf(first.origin), nameOf(second.origin)];
    throw new IncompatibleRelation(
      `${needs} on one database; these are on ${one} and ${one === two ? "another" : two}`,
    );
  }
  return first;
}

/** A record's link to its database: the one it is on now, and a way to move it to another. */
interface DatabaseLink {
  readonly executor: Executor;
  belongTo(executor: Executor): void;
}

/**
 * The one database `links` (and `handles`, a batch's statements) share, each record pinned to
 * it before anything runs (#93): two databases throw `IncompatibleRelation`, with no validation,
 * callback or write run. A record keeps the database it was first written on.
 */
export async function pinBefore(
  links: readonly DatabaseLink[],
  needs: string,
  handles: readonly Executor[] = [],
): Promise<D1Executor> {
  const all = [...handles, ...links.map((link) => link.executor)];
  const database = await oneDatabase(all as [Executor, ...Executor[]], needs);
  for (const link of links) link.belongTo(database);
  return database;
}

/**
 * The records a write prepared, pinned to its database too: any a callback added on the way,
 * from another database, still throws `IncompatibleRelation` before anything is written.
 */
export async function pinClaimed(
  links: readonly DatabaseLink[],
  database: D1Executor,
  needs: string,
): Promise<void> {
  await pinBefore(links, needs, [database]);
}

/**
 * Handles combined into one (`merge`, `or`, a scope's result): checked when a statement runs, since
 * a level-1 binding can only be found then. The same handle twice is just that handle.
 */
export function jointly(a: Executor, b: Executor, needs: string): Executor {
  return a === b ? a : new JointExecutor([a, b], needs);
}

/** Several handles that must be one database, found each time a statement runs. */
class JointExecutor extends ForwardingExecutor {
  readonly #handles: readonly [Executor, ...Executor[]];
  readonly #needs: string;

  constructor(handles: readonly [Executor, ...Executor[]], needs: string) {
    super();
    this.#handles = handles;
    this.#needs = needs;
  }

  [resolve](): Promise<D1Executor> {
    return oneDatabase(this.#handles, this.#needs);
  }
}
