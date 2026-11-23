// The request cache (#218): one `withDatabase` scope's answers to the reads its database was sent, by their SQL and bound values.
import type { CompiledSql } from "./compiler.ts";
import type { StatementResult } from "./driver.ts";

/**
 * A read's key: its SQL and bound values, which only match a read that's the same. A value JSON
 * can't write (a BigInt, a cycle) gives none, so the read is sent, and the database answers it.
 */
function keyOf({ sql, params }: CompiledSql): string | undefined {
  try {
    return JSON.stringify([sql, params]);
  } catch {
    return undefined;
  }
}

/** How many answers a request cache keeps: enough for a request, bounded for a long one. */
const CAPACITY = 100;

/**
 * The answers one scope's database gave to its reads, each kept from when it's sent, so an
 * identical read sent meanwhile waits for it. Clearing forgets those in flight too. It keeps the
 * 100 used last: a Map iterates in insertion order, so each answer used is moved to its end.
 */
export class RequestCache {
  readonly #answers = new Map<string, Promise<StatementResult>>();

  /** The answer `read` has, or will have, if it was sent before. */
  get(read: CompiledSql): Promise<StatementResult> | undefined {
    const key = keyOf(read);
    if (key === undefined) return undefined;
    const answer = this.#answers.get(key);
    if (answer !== undefined) {
      this.#answers.delete(key);
      this.#answers.set(key, answer);
    }
    return answer;
  }

  /** Forgets every answer: its database was written to (or may have been, by a write that failed). */
  clear(): void {
    this.#answers.clear();
  }

  /** Keeps `answer` as `read`'s, unless it fails, or `read` has no key. Its failure is the caller's. */
  set(read: CompiledSql, answer: Promise<StatementResult>): void {
    const key = keyOf(read);
    answer.catch(() => {
      if (key !== undefined && this.#answers.get(key) === answer) this.#answers.delete(key);
    });
    if (key === undefined) return;
    this.#answers.set(key, answer);
    if (this.#answers.size > CAPACITY) this.#answers.delete(this.#answers.keys().next().value!);
  }
}
