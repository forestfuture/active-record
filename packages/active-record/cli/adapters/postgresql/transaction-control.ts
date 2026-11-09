// Finds a migration's own transaction control (BEGIN, COMMIT, ROLLBACK, …), which would end the transaction the command runs it in.

/** Where a `--` comment starting at `index` ends: at the end of its line. */
function lineEnd(sql: string, index: number): number {
  const end = sql.indexOf("\n", index);
  return end < 0 ? sql.length : end;
}

/** Where a `/* … *\/` comment starting at `index` ends. */
function blockEnd(sql: string, index: number): number {
  const end = sql.indexOf("*/", index + 2);
  return end < 0 ? sql.length : end + 2;
}

/** Just past a quoted string or name starting at `index`: `''` doubles a quote, and `E'…'` escapes. */
function quoteEnd(sql: string, index: number, escapes: boolean): number {
  const quote = sql[index]!;
  let at = index + 1;
  while (at < sql.length) {
    if (escapes && sql[at] === "\\") at += 2;
    else if (sql[at] !== quote) at += 1;
    else if (sql[at + 1] === quote) at += 2;
    else return at + 1;
  }
  return sql.length;
}

/** Just past a dollar-quoted body (`$$ … $$`, `$body$ … $body$`) starting at `index`, if one does. */
function dollarEnd(sql: string, index: number): number {
  const tag = /^\$(?:[A-Za-z_]\w*)?\$/.exec(sql.slice(index))?.[0];
  if (tag === undefined) return index;
  const end = sql.indexOf(tag, index + tag.length);
  return end < 0 ? sql.length : end + tag.length;
}

/** Whether a string starting at `index` is an escape string (`E'…'`). */
const escapeString = (sql: string, index: number) =>
  /[eE]/.test(sql[index - 1] ?? "") && !/\w/.test(sql[index - 2] ?? "");

/** Where the quoted or commented text starting at `index` ends, or `index` when none starts there. */
function skipped(sql: string, index: number): number {
  if (sql.startsWith("--", index)) return lineEnd(sql, index);
  if (sql.startsWith("/*", index)) return blockEnd(sql, index);
  const char = sql[index];
  if (char === "'") return quoteEnd(sql, index, escapeString(sql, index));
  if (char === '"') return quoteEnd(sql, index, false);
  return char === "$" ? dollarEnd(sql, index) : index;
}

/** The SQL with what can't start a statement blanked out: strings, quoted names, comments, bodies. */
function blanked(sql: string): string {
  let out = "";
  let index = 0;
  while (index < sql.length) {
    const end = skipped(sql, index);
    out += end > index ? " " : sql[index];
    index = Math.max(end, index + 1);
  }
  return out;
}

/** A statement that starts, ends or aborts a transaction; a savepoint nests inside one, so it's left out. */
const control =
  /^(begin|start\s+transaction|commit|end|abort|prepare\s+transaction|rollback(?!\s+(?:work\s+|transaction\s+)?to\b))\b/i;

/**
 * The first statement in a migration that would start or end a transaction (`BEGIN`, `COMMIT`,
 * `ROLLBACK`, …), as its keywords; undefined when there's none. Words in strings, quoted names,
 * comments and function bodies (a plpgsql `BEGIN … END`) don't count.
 */
export function transactionControl(sql: string): string | undefined {
  for (const statement of blanked(sql).split(";")) {
    const found = control.exec(statement.trim())?.[1];
    if (found !== undefined) return found.toUpperCase().replaceAll(/\s+/g, " ");
  }
  return undefined;
}

/** Why `migrate` (and the schema, which refuses what it does) won't take these migrations, if it won't. */
export function ownTransactions(
  migrations: readonly { name: string; sql: string }[],
): string | undefined {
  for (const { name, sql } of migrations) {
    const found = transactionControl(sql);
    if (found !== undefined) {
      return `${name} has its own ${found}; leave out BEGIN, COMMIT and ROLLBACK, since migrate runs each migration in a transaction of its own`;
    }
  }
  return undefined;
}
