// The request cache (#218): one `withDatabase` scope's answers to the reads its database was sent, by their SQL and bound values.
import type { CompiledSql } from "./compiler.ts";
import type { StatementResult } from "./driver.ts";

/** A read's key: its SQL and bound values, which only match a read that's the same. */
function keyOf({ sql, params }: CompiledSql): string {
  return JSON.stringify([sql, params]);
}

/**
 * The answers one scope's database gave to its reads, each kept from when it's sent, so an
 * identical read sent meanwhile waits for it. Clearing forgets those in flight too.
 */
export class RequestCache {
  readonly #answers = new Map<string, Promise<StatementResult>>();

  /** The answer `read` has, or will have, if it was sent before. */
  get(read: CompiledSql): Promise<StatementResult> | undefined {
    return this.#answers.get(keyOf(read));
  }

  /** Forgets every answer: its database was written to (or may have been, by a write that failed). */
  clear(): void {
    this.#answers.clear();
  }

  /** Keeps `answer` as `read`'s, unless it fails. */
  set(read: CompiledSql, answer: Promise<StatementResult>): void {
    const key = keyOf(read);
    this.#answers.set(key, answer);
    answer.catch(() => {
      if (this.#answers.get(key) === answer) this.#answers.delete(key);
    });
  }
}
