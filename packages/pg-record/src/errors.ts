// Reading Postgres's errors by their SQLSTATE codes (constraint failures and a missing table), once the row values and refused values Postgres wrote in them are stripped.
import type { ConstraintFailure } from "@forestfuture/active-record/adapter";
import { isObject } from "./is-object.ts";

/** The fields of a `pg` error this adapter reads. */
interface PgError {
  code?: unknown;
  table?: unknown;
  column?: unknown;
  message?: unknown;
  stack?: unknown;
}

const kinds: Record<string, ConstraintFailure["kind"]> = {
  "23505": "unique",
  "23502": "notNull",
  "23503": "foreignKey",
  "23514": "check",
};

const fields = (error: unknown): PgError => (isObject(error) ? (error as PgError) : {});

const text = (value: unknown) => (typeof value === "string" ? value : undefined);

/** The key columns an error's `detail` named, read before `detail` is stripped. */
const keyColumns = new WeakMap<object, string[]>();

/** The key columns in a unique or foreign-key failure's detail. */
function keyColumnsIn(detail: unknown): string[] {
  // "Key (email)=(a@example.com) already exists.", "Key (user_id, slug)=(1, a) …"
  const key = /^Key \((.+?)\)=/.exec(text(detail) ?? "")?.[1];
  return key === undefined ? [] : key.split(", ").map((part) => part.replace(/^"(.*)"$/, "$1"));
}

/**
 * `error` without the fields where Postgres writes a row's values (`detail`: "Key (email)=(…)",
 * "Failing row contains (…)"; `where`; the internal query), so they never reach a log through an
 * error's `cause` or `onQuery`, and a data error's message without the value it refused. Its key
 * columns are kept for `constraintFailure`.
 */
export function withoutRowValues(error: unknown): unknown {
  if (!isObject(error) || !("detail" in error)) return error;
  keyColumns.set(error, keyColumnsIn(error.detail));
  for (const field of ["detail", "where", "internalQuery"])
    delete (error as Record<string, unknown>)[field];
  if (text((error as PgError).code)?.startsWith("22")) withoutRefusedValue(error as PgError);
  return error;
}

/**
 * A data error's message (SQLSTATE class 22) with the value it refused filtered, in its stack
 * too: `invalid input syntax for type uuid: "[FILTERED]"`, `value "[FILTERED]" is out of range`.
 * Postgres quotes the value without escaping it, so all from its first quote to its last goes,
 * but for an enum's quoted type name.
 */
function withoutRefusedValue(error: PgError): void {
  const message = text(error.message);
  const filtered = message === undefined ? undefined : refusedValueFiltered(message);
  if (message === undefined || filtered === message) return;
  error.message = filtered;
  const stack = text(error.stack);
  if (stack !== undefined) error.stack = stack.replace(message, filtered!);
}

/**
 * An enum's refusal, whose type name Postgres quotes as an identifier when it needs to, its own
 * quotes doubled: `enum "Mood": "…"`, `enum app."Mood": "…"`.
 */
const enumRefusal = /^(invalid input value for enum (?:[^\s:"]|"(?:[^"]|"")*")+: )".*"$/s;

/** `message` with its refused value, from its first quote to its last, written `[FILTERED]`. */
function refusedValueFiltered(message: string): string {
  if (enumRefusal.test(message)) return message.replace(enumRefusal, '$1"[FILTERED]"');
  return message.replace(/".*"/s, '"[FILTERED]"');
}

/** The columns a failure names: a not-null's column, or the key in a unique failure's detail. */
function columnsOf(error: unknown, { column }: PgError): string[] {
  const named = text(column);
  if (named !== undefined) return [named];
  return isObject(error) ? (keyColumns.get(error) ?? []) : [];
}

/** What a Postgres constraint failure says failed. Any other error, undefined. */
export function constraintFailure(error: unknown): ConstraintFailure | undefined {
  const failed = fields(error);
  const kind = kinds[text(failed.code) ?? ""];
  if (kind === undefined) return undefined;
  return { kind, table: text(failed.table), columns: columnsOf(error, failed) };
}

/** The table Postgres's "relation … does not exist" names. Any other error, undefined. */
export function missingTable(error: unknown): string | undefined {
  const { code, message } = fields(error);
  if (code !== "42P01") return undefined;
  return /relation "(.+?)" does not exist/.exec(text(message) ?? "")?.[1];
}
