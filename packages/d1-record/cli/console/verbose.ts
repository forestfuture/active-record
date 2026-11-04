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
export function statementLine(event: StatementEvent, dim: boolean): string {
  const { model, params, durationMs, error } = event;
  // SQL that spans lines would break the one-line shape (and the dim span around it).
  const sql = event.sql.replace(/\s*\n\s*/g, " ");
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
