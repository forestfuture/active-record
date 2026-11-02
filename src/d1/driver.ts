// Sends statements to D1: through a binding or a Session, started again when D1 rejects its bookmark (#237).
import type { CompiledSql } from "../compiler.ts";
import type { Driver, StatementResult } from "../driver.ts";
import { boundValue } from "../filtering.ts";
import { isRejectedBookmark, rejectedBookmark } from "./errors.ts";

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

/** The single place the library calls D1. */
export class D1Driver implements Driver {
  #source: D1Database | D1DatabaseSession;
  /** Starts the Session again when D1 rejects the bookmark it started from (#237); once only. */
  #startAgain: (() => D1DatabaseSession) | undefined;
  /** The source each rejected statement went to, so one the Session has left is sent anew. */
  readonly #rejectedOn = new WeakMap<object, D1Database | D1DatabaseSession>();

  /** `source` is the D1 binding itself, or one D1 Session every query goes through. */
  constructor(source: D1Database | D1DatabaseSession) {
    this.#source = source;
  }

  /** The D1 Session its statements go through now, if it has one. */
  get session(): D1DatabaseSession | undefined {
    return "getBookmark" in this.#source ? this.#source : undefined;
  }

  /**
   * Arms a new Session for when D1 rejects the bookmark this one started from (a request's, which
   * may be forged): `startAgain` opens it, and the rejected statement is sent again on it, since
   * it never ran. Disarmed once a statement succeeds.
   */
  whenBookmarkRejected(startAgain: () => D1DatabaseSession): void {
    this.#startAgain = startAgain;
  }

  send(statement: CompiledSql): Promise<StatementResult> {
    return this.#sent(() => this.#prepare(statement).all<Record<string, unknown>>());
  }

  read(statements: readonly CompiledSql[]): Promise<StatementResult[]> {
    return this.#batch(statements);
  }

  write(statements: readonly CompiledSql[]): Promise<StatementResult[]> {
    return this.#batch(statements);
  }

  /** D1's `batch()`: one round trip, and atomic, for reads and writes alike. */
  #batch(statements: readonly CompiledSql[]): Promise<StatementResult[]> {
    return this.#sent(() =>
      this.#source.batch<Record<string, unknown>>(
        statements.map((statement) => this.#prepare(statement)),
      ),
    );
  }

  /** Sends with `send`: a success disarms the restart, and a failure's bookmark is shortened. */
  async #sent<T>(send: () => Promise<T>): Promise<T> {
    const source = this.#source;
    try {
      const sent = await send();
      // The bookmark was good: D1 rejects one on the Session's first statement only.
      this.#startAgain = undefined;
      return sent;
    } catch (error) {
      shortenBookmarkIn(error);
      if (isRejectedBookmark(error)) this.#rejectedOn.set(error as Error, source);
      throw error;
    }
  }

  /**
   * Whether D1 rejected the bookmark and the Session has started again, once, so a statement it
   * rejected can be sent anew. Statements sent at once all fail; each is sent again.
   */
  recover(error: unknown): boolean {
    if (!isRejectedBookmark(error)) return false;
    if (this.#rejectedOn.get(error as Error) !== this.#source) return true;
    if (this.#startAgain === undefined) return false;
    this.#source = this.#startAgain();
    this.#startAgain = undefined;
    return true;
  }

  #prepare({ sql, params }: CompiledSql): D1PreparedStatement {
    return this.#source.prepare(sql).bind(...params.map(boundValue));
  }
}
