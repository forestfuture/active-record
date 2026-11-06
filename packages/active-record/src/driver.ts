// What a database's driver does for the core: sends statements, and returns their rows, how many rows they changed, and the database's own detail.
import type { CompiledSql } from "./compiler.ts";

/** One statement's result, the same on every database. */
export interface StatementResult {
  /** The rows it returned: a read's, or a write's `RETURNING`. */
  rows: Record<string, unknown>[];
  /** How many rows it inserted, updated or deleted. */
  rowsAffected: number;
  /** The database's own timing for it, when it reports one. */
  durationMs?: number | undefined;
  /** The database's own detail about it, for `onQuery` (D1's `meta`). */
  meta?: unknown;
}

/**
 * Sends statements to one database. It knows nothing of Models, `onQuery` or error classes.
 * `Scope` is what it holds for a `withDatabase` scope, handed back with each statement sent inside it.
 */
export interface Driver<Scope = unknown> {
  /** Sends one statement, inside `scope` when one was opened. */
  send(statement: CompiledSql, scope?: Scope): Promise<StatementResult>;
  /** Sends reads at once where it can, resolving to each one's result. They needn't be atomic. */
  read(statements: readonly CompiledSql[], scope?: Scope): Promise<StatementResult[]>;
  /** Sends writes atomically, all or none, resolving to each one's result. */
  write(statements: readonly CompiledSql[], scope?: Scope): Promise<StatementResult[]>;
  /** Whether sending again can succeed after `error`, having readied the connection for it. */
  recover(error: unknown): boolean;
  /**
   * A `withDatabase` call with this database has begun: what the driver holds for it, such as a
   * connection, until `closeScope`. Each call opens its own, so overlapping requests sharing a
   * Database never share one; a call nested in a running one with the same database shares the
   * outer's. Statements sent after it ended (a `waitUntil` save) are still handed it.
   */
  openScope?(): Scope;
  /**
   * The scope `openScope` returned has ended: what it holds can be let go once its statements
   * finish. `withDatabase` waits for it, so it shouldn't wait for them.
   */
  closeScope?(scope: Scope): Promise<void>;
}
