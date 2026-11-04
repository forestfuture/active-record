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

/** Sends statements to one database. It knows nothing of Models, `onQuery` or error classes. */
export interface Driver {
  /** Sends one statement. */
  send(statement: CompiledSql): Promise<StatementResult>;
  /** Sends reads at once where it can, resolving to each one's result. They needn't be atomic. */
  read(statements: readonly CompiledSql[]): Promise<StatementResult[]>;
  /** Sends writes atomically, all or none, resolving to each one's result. */
  write(statements: readonly CompiledSql[]): Promise<StatementResult[]>;
  /** Whether sending again can succeed after `error`, having readied the connection for it. */
  recover(error: unknown): boolean;
}
