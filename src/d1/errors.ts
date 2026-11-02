// Reading D1's errors: constraint failures, a missing table, and a query outside a request.
import type { ConstraintFailure } from "../adapter.ts";
import { NoDatabase } from "../errors.ts";

const messageOf = (error: unknown) => (error instanceof Error ? error.message : String(error));

/** D1 constraint messages, e.g. "UNIQUE constraint failed: users.email: SQLITE_CONSTRAINT …". */
const KINDS: readonly (readonly [pattern: RegExp, kind: ConstraintFailure["kind"]])[] = [
  [/UNIQUE constraint failed: ([^:]+)/, "unique"],
  [/NOT NULL constraint failed: ([^:]+)/, "notNull"],
  [/FOREIGN KEY constraint failed/, "foreignKey"],
  [/CHECK constraint failed/, "check"],
];

/** What D1's message names: "users.email, users.role" → users, [email, role]. */
function namedIn(list: string | undefined): Pick<ConstraintFailure, "table" | "columns"> {
  const entries = (list ?? "").split(",").map((entry) => entry.trim().split("."));
  const table = entries[0]?.length === 2 ? entries[0][0] : undefined;
  const columns = entries.filter(([name]) => name === table).map(([, column]) => column!);
  return { table, columns };
}

/** What a D1 constraint failure says failed. Any other error, undefined. */
export function constraintFailure(error: unknown): ConstraintFailure | undefined {
  const message = messageOf(error);
  for (const [pattern, kind] of KINDS) {
    const match = pattern.exec(message);
    if (match !== null) return { kind, ...namedIn(match[1]) };
  }
  return undefined;
}

/** The table D1's "no such table" names. Any other error, undefined. */
export function missingTable(error: unknown): string | undefined {
  return /no such table: ([^\s:]+)/.exec(messageOf(error))?.[1];
}

/**
 * Workers' refusal of a D1 call outside a request (a query at a module's top level), as a
 * `NoDatabase` saying where queries belong; any other error, undefined.
 */
export function outsideRequest(error: unknown): NoDatabase | undefined {
  if (!/within global scope/i.test(messageOf(error))) return undefined;
  return new NoDatabase(
    "Queries run during a request: Workers don't allow D1 calls at a module's top level. Move " +
      "the query into your fetch handler, or a function it calls",
    { cause: error },
  );
}
