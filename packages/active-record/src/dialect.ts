// What the compiler can't write the same way on every database (ADR-0018), and its placeholders.
import type { Attribute } from "./attribute.ts";
import type { CompiledSql } from "./compiler.ts";

/**
 * Where compiled SQL binds a value, in its own order. A dialect writes each as its database's
 * placeholder once the SQL is complete, so a `?` in a raw `sql` fragment's text (Postgres's jsonb
 * operator) is never read as one. NUL, since no database accepts it in a statement's text.
 */
export const param = "\u0000";

/** The SQL a database needs in its own form. Everything else in the compiler is shared. */
export interface Dialect {
  /** The placeholder for the `index`th bound value, from 1: `?`, or `$1`. */
  placeholder(index: number): string;
  /** `column` in a list of `cells` bound as one value, so any length fits a statement's limits. */
  inList(column: string, cells: readonly unknown[]): { sql: string; value: unknown };
  /** `limit` and `offset`, at least one of them set, as this database writes them, their values added to `params`. */
  pagination(limit: number | undefined, offset: number | undefined, params: unknown[]): string;
  /**
   * Where a bulk insert into `table` (quoted) reads its rows of `attributes`, from one bound JSON
   * value: its SELECT list and FROM.
   */
  bulkRows(table: string, attributes: readonly Attribute[]): { select: string; from: string };
  /**
   * The owners' `key` (a quoted column, of `keyAttribute`) as a linked condition selects it, so
   * it matches `linked`'s column as a condition on `linked` would: by text for a text attribute.
   */
  linkedKey(key: string, keyAttribute: Attribute, linked: Attribute): string;
}

/** `compiled` with each `param` written as `dialect`'s placeholder: the SQL as it's sent. */
export function withPlaceholders(dialect: Dialect, compiled: CompiledSql): CompiledSql {
  if (!compiled.sql.includes(param)) return compiled;
  let index = 0;
  const sql = compiled.sql.replaceAll(param, () => dialect.placeholder(++index));
  return { ...compiled, sql };
}
