// Sending statements through a database's Driver and reporting each to `onQuery`, where a database is from, and the pinning of records to it.
import { shownValue } from "./filtering.ts";
import type { CompiledSql } from "./compiler.ts";
import type { Adapter } from "./adapter.ts";
import { translateConstraintError } from "./constraints.ts";
import { sqlite } from "./d1/dialect.ts";
import type { Dialect } from "./dialect.ts";
import type { Driver, StatementResult } from "./driver.ts";
import { IncompatibleRelation } from "./errors.ts";
import type { ModelClass } from "./model.ts";
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
  /** Runs reads together and resolves to each one's result. They needn't be atomic. */
  read(statements: readonly CompiledSql[]): Promise<StatementResult[]>;
  /** Runs statements atomically: one on its own, several as one batch. */
  write(statements: readonly CompiledSql[]): Promise<StatementResult[]>;
  /** @internal The DatabaseExecutor that sends now: itself, or the current database's. */
  [resolve](): Promise<DatabaseExecutor>;
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
 * One database's Executor: every statement goes to its Driver and is reported to `onQuery`, and a
 * constraint failure becomes the matching `ConstraintViolation` for the statement's Model.
 */
export class DatabaseExecutor implements Executor {
  readonly #adapter: Adapter;
  readonly #driver: Driver;
  readonly #onQuery: QueryListener | undefined;
  #origin: Origin = "connect";

  constructor(adapter: Adapter, driver: Driver, onQuery?: QueryListener) {
    this.#adapter = adapter;
    this.#driver = driver;
    this.#onQuery = onQuery;
  }

  get dialect(): Dialect {
    return this.#adapter.dialect;
  }

  async [resolve](): Promise<DatabaseExecutor> {
    return this;
  }

  /** Where this database came from; errors name it by this. */
  get origin(): Origin {
    return this.#origin;
  }

  /**
   * @internal Sets where this database came from (#170): `withDatabase` makes it `"request"`, and
   * a binding's own Database takes `{ binding }`. It lives on the executor because records keep
   * their DatabaseExecutor and outlive `withDatabase`, so a per-request lookup couldn't find it later.
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

  /** Runs reads together and resolves to each one's result (rows and `meta`). */
  async read(statements: readonly CompiledSql[]): Promise<StatementResult[]> {
    return this.#together(statements, () => this.#driver.read(statements));
  }

  /**
   * `statements`, sent by `send`, unless there are none. They fail as a whole, so on failure every
   * one is reported with the error.
   */
  async #together(
    statements: readonly CompiledSql[],
    send: () => Promise<StatementResult[]>,
  ): Promise<StatementResult[]> {
    if (statements.length === 0) return [];
    return this.#driver.attempt(() => this.#togetherOnce(statements, send));
  }

  async #togetherOnce(
    statements: readonly CompiledSql[],
    send: () => Promise<StatementResult[]>,
  ): Promise<StatementResult[]> {
    const started = performance.now();
    let results: StatementResult[];
    try {
      results = await send();
    } catch (error) {
      const durationMs = performance.now() - started;
      for (const statement of statements) this.#report(statement, { durationMs, error });
      throw this.#explained(
        error,
        statements.map(({ model }) => model),
      );
    }
    // D1 times each statement of a batch itself.
    statements.forEach((statement, index) => {
      const { meta } = results[index]!;
      this.#report(statement, { durationMs: meta.duration, meta });
    });
    return results;
  }

  /** Runs statements atomically: one on its own, several all or none. Resolves to each result. */
  async write(statements: readonly CompiledSql[]): Promise<StatementResult[]> {
    const [only] = statements;
    if (statements.length === 1 && only !== undefined) return [await this.#one(only)];
    return this.#together(statements, () => this.#driver.write(statements));
  }

  async #one(query: CompiledSql): Promise<StatementResult> {
    return this.#driver.attempt(() => this.#oneOnce(query));
  }

  async #oneOnce(query: CompiledSql): Promise<StatementResult> {
    const { model } = query;
    const started = performance.now();
    let result: StatementResult;
    try {
      result = await this.#driver.send(query);
    } catch (error) {
      this.#report(query, { durationMs: performance.now() - started, error });
      throw this.#explained(error, [model]);
    }
    this.#report(query, { durationMs: performance.now() - started, meta: result.meta });
    return result;
  }

  /** What to throw for `error` from a write to `models`' tables. */
  #explained(error: unknown, models: readonly ModelClass[]): unknown {
    const adapter = this.#adapter;
    return (
      adapter.refusal(error) ??
      explainMissingTable(adapter, translateConstraintError(adapter, error, models), models)
    );
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
}

/** An Executor that finds its DatabaseExecutor when a statement runs, and sends the statement there. */
abstract class ForwardingExecutor implements Executor {
  // Statements compile before their database is found, so this can't ask it. D1 is the only one.
  readonly dialect = sqlite;

  abstract [resolve](): Promise<DatabaseExecutor>;

  async all(query: CompiledSql): Promise<Record<string, unknown>[]> {
    return (await this[resolve]()).all(query);
  }

  async run(query: CompiledSql): Promise<D1Meta> {
    return (await this[resolve]()).run(query);
  }

  async read(statements: readonly CompiledSql[]): Promise<StatementResult[]> {
    return (await this[resolve]()).read(statements);
  }

  async write(statements: readonly CompiledSql[]): Promise<StatementResult[]> {
    return (await this[resolve]()).write(statements);
  }
}

/**
 * The current database's Executor (#77): finds the DatabaseExecutor to use each time a statement runs,
 * the request's or the binding's, so a Relation built from a Model's statics can be built anywhere.
 */
export class CurrentExecutor extends ForwardingExecutor {
  readonly #find: () => Promise<DatabaseExecutor>;

  constructor(find: () => Promise<DatabaseExecutor>) {
    super();
    this.#find = find;
  }

  [resolve](): Promise<DatabaseExecutor> {
    return this.#find();
  }
}

/** The DatabaseExecutor `handle` sends to now. */
export function databaseNow(handle: Executor): Promise<DatabaseExecutor> {
  return handle[resolve]();
}

/**
 * The one database these handles resolve to now: their DatabaseExecutor. Two databases throw
 * `IncompatibleRelation` (#93): "`needs` on one database", naming where each came from. Every
 * check of "the same database" (merge, or, scopes, batches, saves) and every pin goes here.
 */
async function oneDatabase(
  handles: readonly [Executor, ...Executor[]],
  needs: string,
): Promise<DatabaseExecutor> {
  const databases = [...new Set(await Promise.all(handles.map((handle) => handle[resolve]())))];
  const [first, second] = databases as [DatabaseExecutor, DatabaseExecutor | undefined];
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
): Promise<DatabaseExecutor> {
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
  database: DatabaseExecutor,
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

  [resolve](): Promise<DatabaseExecutor> {
    return oneDatabase(this.#handles, this.#needs);
  }
}
