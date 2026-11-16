// The `--verbose` line for a statement: its Model, time, SQL and bound values (#104).
import { inspect } from "node:util";

/** What the console uses of a query event. */
export interface StatementEvent {
  model: string;
  sql: string;
  params: unknown[];
  durationMs: number;
  error?: unknown;
}

/**
 * One line for a statement, as `onQuery` saw it (filtered values are already `[FILTERED]`):
 * `  User  1.2ms  SELECT … WHERE "id" = ?  [ 1 ]`, or `failed` and the reason in place of the time
 * and values. Dim on a terminal, so it reads as background to the results.
 */
/**
 * `sql` on one line: each line break, with the spaces around it, as one space. Split rather than
 * matched by a regex of spaces, a line break and spaces, which rescans a long run of spaces from
 * each place in it.
 */
function oneLine(sql: string): string {
  const lines = sql.split("\n");
  if (lines.length === 1) return sql;
  const middle = lines.slice(1, -1).map((line) => line.trim());
  const parts = [
    lines[0]!.trimEnd(),
    ...middle.filter((line) => line !== ""),
    lines.at(-1)!.trimStart(),
  ];
  return parts.join(" ");
}

export function statementLine(event: StatementEvent, dim: boolean): string {
  const { model, params, durationMs, error } = event;
  // SQL that spans lines would break the one-line shape (and the dim span around it).
  const sql = oneLine(event.sql);
  let line = `  ${model}  `;
  if (error !== undefined) {
    line += `failed  ${sql}  ${error instanceof Error ? error.message : inspect(error)}`;
  } else {
    line += `${durationMs.toFixed(1)}ms  ${sql}`;
    if (params.length > 0) {
      line += `  ${inspect(params, { breakLength: Number.POSITIVE_INFINITY })}`;
    }
  }
  return dim ? `\u001b[2m${line}\u001b[22m` : line;
}
