// The request cache (#218): one `withDatabase` scope's answers to the reads its database was sent, by their SQL and bound values.
import type { CompiledSql } from "./compiler.ts";
import type { StatementResult } from "./driver.ts";

/** A read's key: its SQL and bound values, which only match a read that's the same. */
function keyOf({ sql, params }: CompiledSql): string {
  return JSON.stringify([sql, params]);
}

/** The answers one scope's database gave to its reads. */
export class RequestCache {
  readonly #answers = new Map<string, StatementResult>();

  /** The answer `read` had, if it was sent before. */
  get(read: CompiledSql): StatementResult | undefined {
    return this.#answers.get(keyOf(read));
  }

  /** Forgets every answer: its database was written to (or may have been, by a write that failed). */
  clear(): void {
    this.#answers.clear();
  }

  /** Keeps `result` as `read`'s answer. */
  set(read: CompiledSql, result: StatementResult): void {
    this.#answers.set(keyOf(read), result);
  }
}
