// Each statement's kind, its first word, to count the statements a test sent by kind (#400).
import type { QueryEvent } from "../../packages/active-record/src/executor.ts";

/** The kind of each statement in `events`: `SELECT`, `INSERT`, `UPDATE` or `DELETE`. */
export function statementKinds(events: readonly Pick<QueryEvent, "sql">[]): string[] {
  return events.map(({ sql }) => sql.trimStart().split(/\s/, 1)[0]!);
}
