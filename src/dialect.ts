// What the compiler can't write the same way on every database (ADR-0018), with SQLite's as `sqlite`.

/** The SQL a database needs in its own form. Everything else in the compiler is shared. */
export interface Dialect {
  /** `column` in a list of `cells` bound as one value, so any length fits a statement's limits. */
  inList(column: string, cells: readonly unknown[]): { sql: string; value: unknown };
}

/** D1's dialect. */
export const sqlite: Dialect = {
  inList: (column, cells) => ({
    sql: `${column} IN (SELECT value FROM json_each(?))`,
    value: JSON.stringify(cells),
  }),
};
