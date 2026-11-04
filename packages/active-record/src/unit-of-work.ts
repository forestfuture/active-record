// Writing prepared writes as one atomic batch, then committing each and running its callbacks.
import type { CompiledSql } from "./compiler.ts";
import type { StatementResult } from "./driver.ts";
import type { Executor } from "./executor.ts";

/**
 * One part of a unit of work, prepared: its statements, what the record takes on once they're
 * written, and the callbacks that run after that.
 */
export interface PreparedWrite {
  statements: readonly CompiledSql[];
  /** Called with the results of its own statements, in order, once the batch succeeded. */
  commit(results: readonly StatementResult[]): void;
  after(): Promise<void>;
}

/** A prepared write for plain statements: nothing to commit, no callbacks. */
export function statementWrite(statements: readonly CompiledSql[]): PreparedWrite {
  return { statements, commit: () => {}, after: async () => {} };
}

/**
 * Sends every write's statements as one atomic batch (or one statement on its own), then
 * commits each write with its own results. Nothing is committed if D1 refuses the batch.
 */
export async function writeAll(
  executor: Executor,
  writes: readonly PreparedWrite[],
): Promise<StatementResult[]> {
  const statements = writes.flatMap((write) => write.statements);
  const results = statements.length === 0 ? [] : await executor.write(statements);
  let offset = 0;
  for (const write of writes) {
    write.commit(results.slice(offset, offset + write.statements.length));
    offset += write.statements.length;
  }
  return results;
}

/** Runs the after-callbacks of written writes, in order. */
export async function runAfter(writes: readonly PreparedWrite[]): Promise<void> {
  for (const write of writes) await write.after();
}
