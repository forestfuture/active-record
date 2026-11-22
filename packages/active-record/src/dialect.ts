// What the compiler can't write the same way on every database (ADR-0018), and its placeholders.
import type { Attribute } from "./attribute.ts";
import type { CompiledSql } from "./compiler.ts";

/**
 * Where compiled SQL binds a value, in its own order. A dialect writes each as its database's
 * placeholder once the SQL is complete, so a `?` in a raw `sql` fragment's text (Postgres's jsonb
 * operator) is never read as one. NUL, since no database accepts it in a statement's text.
 */
export const valueMark = "\u0000";

/** The SQL a database needs in its own form. Everything else in the compiler is shared. */
export interface Dialect {
  /** The placeholder for the `index`th bound value, from 1: `?`, or `$1`. */
  placeholder(index: number): string;
  /**
   * `column`, of `attribute`, in a list of `cells` bound as one value, so any length fits a
   * statement's limits.
   */
  inList(
    column: string,
    cells: readonly unknown[],
    attribute: Attribute,
  ): { sql: string; value: unknown };
  /**
   * The place of `column`'s value in a list of `cells` (a NULL among them included) bound as one
   * value, for `inOrderOf` (#350): earlier values sort first, and a value not in it is NULL.
   */
  placeInList(
    column: string,
    cells: readonly unknown[],
    attribute: Attribute,
  ): { sql: string; value: unknown };
  /** `limit` and `offset`, at least one of them set, as this database writes them, their values added to `params`. */
  pagination(limit: number | undefined, offset: number | undefined, params: unknown[]): string;
  /**
   * Where a bulk insert into `table` (quoted) reads its rows of `attributes`, from one bound JSON
   * value: its SELECT list and FROM.
   */
  bulkRows(table: string, attributes: readonly Attribute[]): { select: string; from: string };
  /**
   * The most UTF-8 bytes one bound value may hold, when the database caps it: a bulk write whose
   * rows would pass it is sent as several statements, in one atomic batch (#392).
   */
  maxValueBytes?: number;
  /**
   * The owners' `key` (a quoted column, of `keyAttribute`) as a linked condition selects it, so
   * it matches `linked`'s column as a condition on `linked` would: by text for a text attribute.
   */
  linkedKey(key: string, keyAttribute: Attribute, linked: Attribute): string;
  /**
   * A bulk removal (a DELETE, or an UPDATE nullifying a key) and the counter caches it changes
   * (#61), as one statement: `decrements` writes the counters' UPDATEs, given SQL counting the rows
   * removed, and the statement returns one row, whose `removed` is how many. Without it, the
   * counters are taken down by a COUNT sent just before the removal: exact where writes run one
   * at a time.
   */
  /**
   * A record's write that must change its row (an update or delete by its key and `lockVersion`,
   * #357), followed by a check that fails the whole atomic batch when it changed none, with an
   * error whose message holds `marker`, bound as a value: one statement or several, the write's
   * result first.
   */
  staleGuard(write: CompiledSql, marker: string): CompiledSql[];
  countedRemoval?(
    removal: CompiledSql,
    decrements: (removed: string) => readonly CompiledSql[],
  ): CompiledSql;
}

/** `compiled` with each `valueMark` written as `dialect`'s placeholder: the SQL as it's sent. */
export function withPlaceholders(dialect: Dialect, compiled: CompiledSql): CompiledSql {
  if (!compiled.sql.includes(valueMark)) return compiled;
  let index = 0;
  const sql = compiled.sql.replaceAll(valueMark, () => dialect.placeholder(++index));
  return { ...compiled, sql };
}
