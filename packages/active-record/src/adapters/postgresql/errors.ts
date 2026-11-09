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

const enumRefusal = "invalid input value for enum ";

/** Where the quoted identifier opening at `at` ends, past its closing quote; its own quotes are doubled. -1 if it never closes. */
function quotedEnd(message: string, at: number): number {
  let next = at + 1;
  while (next < message.length) {
    if (message[next] !== '"') next += 1;
    else if (message[next + 1] === '"') next += 2;
    else return next + 1;
  }
  return -1;
}

/**
 * Where an enum refusal's type name ends: identifiers joined by dots, each bare or quoted
 * (`mood`, `"Mood"`, `app."Mood"`), read in one pass. -1 if it isn't one.
 */
function enumNameEnd(message: string): number {
  let at = enumRefusal.length;
  for (;;) {
    if (message[at] === '"') at = quotedEnd(message, at);
    else while (at < message.length && !/[\s:".]/.test(message[at]!)) at += 1;
    if (at === -1 || message[at] !== ".") return at;
    at += 1;
  }
}

/**
 * `message` with its refused value, from its first quote to its last, written `[FILTERED]`, but
 * for an enum's quoted type name: `invalid input value for enum "Mood": "[FILTERED]"`. Scanned,
 * not matched with a pattern that could backtrack, since the value is the user's.
 */
function refusedValueFiltered(message: string): string {
  if (message.startsWith(enumRefusal)) {
    const end = enumNameEnd(message);
    if (end !== -1 && message.startsWith(': "', end) && message.endsWith('"')) {
      return `${message.slice(0, end)}: "[FILTERED]"`;
    }
  }
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
