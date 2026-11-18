// How many records a Relation has, answered from a loaded association's records where it can: `size`, `exists`, `isEmpty` and `hasAny`.
import type { Model } from "./model.ts";
import { count, type ValueSource } from "./calculations.ts";
import { compileExists } from "./compiler.ts";
import { atMostOne } from "./finder-order.ts";

/** What answering how many records there are reads: a Relation's values, and its owner's unsaved records. */
export interface CountSource extends ValueSource {
  /** An association's records built through it and not yet saved. */
  readonly unsavedCount: () => number;
}

/**
 * The number of records, as Rails' `size`: a loaded association's (built records included)
 * without a query; otherwise a `COUNT(*)`, plus an association's unsaved built records.
 */
export async function size(source: CountSource): Promise<number> {
  const cached: readonly Model[] | undefined = source.cached();
  if (cached !== undefined) return cached.length;
  return (await count(source)) + source.unsavedCount();
}

/** Whether there are no records: a loaded association answers itself, else `!exists()`. */
export async function isEmpty(source: CountSource): Promise<boolean> {
  const cached = source.cached();
  if (cached !== undefined) return cached.length === 0;
  if (source.unsavedCount() > 0) return false;
  return !(await exists(source));
}

/** Whether any row matches, with one `SELECT 1 … LIMIT 1` in the Relation's page. */
export async function exists({ query, dialect, runner }: ValueSource): Promise<boolean> {
  const limited = { ...query, limit: atMostOne(query.limit) };
  return (await runner.rows(() => compileExists(dialect(), limited))).length > 0;
}
