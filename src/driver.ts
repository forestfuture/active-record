// What a database's driver does for the core: sends statements, and returns their rows and `meta`.
import type { CompiledSql } from "./compiler.ts";

/** One statement's rows and `meta`. */
export type StatementResult = D1Result<Record<string, unknown>>;

/** Sends statements to one database. It knows nothing of Models, `onQuery` or error classes. */
export interface Driver {
  /** Sends one statement. */
  send(statement: CompiledSql): Promise<StatementResult>;
  /** Sends reads at once where it can, resolving to each one's result. They needn't be atomic. */
  read(statements: readonly CompiledSql[]): Promise<StatementResult[]>;
  /** Sends writes atomically, all or none, resolving to each one's result. */
  write(statements: readonly CompiledSql[]): Promise<StatementResult[]>;
  /** Runs `send`, once or again if this database's connection can recover from its failure. */
  attempt<T>(send: () => Promise<T>): Promise<T>;
}
