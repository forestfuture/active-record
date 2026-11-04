// What the compiler can't write the same way on every database (ADR-0018).
import type { Attribute } from "./attribute.ts";

/** The SQL a database needs in its own form. Everything else in the compiler is shared. */
export interface Dialect {
  /** `column` in a list of `cells` bound as one value, so any length fits a statement's limits. */
  inList(column: string, cells: readonly unknown[]): { sql: string; value: unknown };
  /** `limit` and `offset`, at least one of them set, as this database writes them, their values added to `params`. */
  pagination(limit: number | undefined, offset: number | undefined, params: unknown[]): string;
  /** Where a bulk insert reads its rows of `attributes`, from one bound JSON value: its SELECT list and FROM. */
  bulkRows(attributes: readonly Attribute[]): { select: string; from: string };
}
