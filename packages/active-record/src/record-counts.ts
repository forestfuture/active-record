// How many records a Relation has, answered from a loaded association's records where it can: `size`, `exists`, `isEmpty`, `hasAny`, `hasMoreThanOne` and `hasExactlyOne`.
import type { Model } from "./model.ts";
import { count, type ValueSource } from "./calculations.ts";
import { compileExists } from "./compiler.ts";
import { atMostOne } from "./finder-order.ts";

/** What answering how many records there are reads: a Relation's values, and its owner's unsaved records. */
export interface CountSource extends ValueSource {
  /** An association's records built through it and not yet saved. */
  readonly unsavedCount: () => number;
  /** How many records an association has by its owner's counter cache (#61), if it keeps one. */
  readonly counted?: () => number | undefined;
}

/**
 * The number of records, as Rails' `size`: a loaded association's (built records included)
 * without a query, or its owner's counter cache's (#61); otherwise a `COUNT(*)`; plus an
 * association's unsaved built records.
 */
export async function size(source: CountSource): Promise<number> {
  const cached: readonly Model[] | undefined = source.cached();
  if (cached !== undefined) return cached.length;
  const counted = source.counted?.() ?? (await count(source));
  return counted + source.unsavedCount();
}

/**
 * Whether there are no records: a loaded association answers itself, or one whose owner keeps a
 * counter cache by it, as Rails' `empty?` does (#61); else `!exists()`.
 */
export async function isEmpty(source: CountSource): Promise<boolean> {
  const cached = source.cached();
  if (cached !== undefined) return cached.length === 0;
  if (source.unsavedCount() > 0) return false;
  const counted = source.counted?.();
  return counted === undefined ? !(await exists(source)) : counted === 0;
}

/** Whether any row matches, with one `SELECT 1 … LIMIT 1` in the Relation's page. */
export async function exists({ query, dialect, runner }: ValueSource): Promise<boolean> {
  const limited = { ...query, limit: atMostOne(query.limit) };
  return (await runner.rows(() => compileExists(dialect(), limited))).length > 0;
}

/**
 * How many records there are, counting no further than two, as Rails' `many?` and `one?` count:
 * a loaded association's, or a `COUNT` of at most two rows, plus an association's unsaved ones.
 */
export async function upToTwo(source: CountSource): Promise<number> {
  const cached = source.cached();
  if (cached !== undefined) return cached.length;
  const { query } = source;
  const limited = { ...source, query: { ...query, limit: Math.min(query.limit ?? 2, 2) } };
  return (await count(limited)) + source.unsavedCount();
}
