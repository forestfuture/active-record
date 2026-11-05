// Reading Postgres's errors by their SQLSTATE codes: constraint failures and a missing table.
import type { ConstraintFailure } from "@forestfuture/active-record/adapter";

/** The fields of a `pg` error this adapter reads. */
interface PgError {
  code?: unknown;
  table?: unknown;
  column?: unknown;
  detail?: unknown;
  message?: unknown;
}

const kinds: Record<string, ConstraintFailure["kind"]> = {
  "23505": "unique",
  "23502": "notNull",
  "23503": "foreignKey",
  "23514": "check",
};

const fields = (error: unknown): PgError =>
  typeof error === "object" && error !== null ? (error as PgError) : {};

const text = (value: unknown) => (typeof value === "string" ? value : undefined);

/** The columns a failure names: a not-null's column, or the key in a unique failure's detail. */
function columnsOf({ column, detail }: PgError): string[] {
  const named = text(column);
  if (named !== undefined) return [named];
  // "Key (email)=(a@example.com) already exists.", "Key (user_id, slug)=(1, a) …"
  const key = /^Key \((.+?)\)=/.exec(text(detail) ?? "")?.[1];
  return key === undefined ? [] : key.split(", ").map((part) => part.replace(/^"(.*)"$/, "$1"));
}

/** What a Postgres constraint failure says failed. Any other error, undefined. */
export function constraintFailure(error: unknown): ConstraintFailure | undefined {
  const failed = fields(error);
  const kind = kinds[text(failed.code) ?? ""];
  if (kind === undefined) return undefined;
  return { kind, table: text(failed.table), columns: columnsOf(failed) };
}

/** The table Postgres's "relation … does not exist" names. Any other error, undefined. */
export function missingTable(error: unknown): string | undefined {
  const { code, message } = fields(error);
  if (code !== "42P01") return undefined;
  return /relation "(.+?)" does not exist/.exec(text(message) ?? "")?.[1];
}
