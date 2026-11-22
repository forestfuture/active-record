// Optimistic locking (#357): a record's `lockVersion`, checked and incremented by its update, destroy and `touch()`, and the guard that fails the whole write when another write changed its row first.
import { attributeFor } from "./attribute.ts";
import type { Assignment, CompiledSql } from "./compiler.ts";
import { valueMark } from "./dialect.ts";
import { StaleRecord, type StaleAction } from "./errors.ts";
import { modelOf, type Model } from "./model.ts";
import { quoteIdentifier } from "./query-tables.ts";
import { state } from "./record-state.ts";
import type { PreparedWrite } from "./unit-of-work.ts";
import { isLocking, lockVersion } from "./lock-version.ts";

/** The record's lock version: the one loaded, or one assigned, as from a form; a NULL reads as 0. */
export function versionOf(record: Model): number {
  return (record[state].read(lockVersion) as number | null) ?? 0;
}

/** A new locked record's version, when it has none: it's written with 0. */
export function firstVersion(record: Model): Assignment[] {
  const isUnset = isLocking(modelOf(record)) && record[state].read(lockVersion) === null;
  return isUnset ? [[lockVersion, 0]] : [];
}

/**
 * What a locked record's write adds: the version it gives the row, its statements with the
 * condition on the version and the guard after them, and the error to throw for a refused batch.
 */
export interface Lock {
  /** `lockVersion` set to one past the version the write expects. */
  next: Assignment;
  /** The write by the record's key, made to match only the version it expects, then the guard. */
  guarded: (write: CompiledSql) => CompiledSql[];
  /** A `StaleRecord` when the guard refused the batch, or undefined. */
  failed: (error: unknown) => Error | undefined;
}

/**
 * The lock on `record`'s write, or undefined when its Model doesn't lock. The version it expects
 * is the record's (`versionOf`).
 */
export function lockOf(record: Model, action: StaleAction): Lock | undefined {
  if (!isLocking(modelOf(record))) return undefined;
  const expected = versionOf(record);
  const marker = `active-record stale record ${crypto.randomUUID()}`;
  return {
    next: [lockVersion, expected + 1],
    guarded: (write) =>
      record[state].executor.dialect.staleGuard(withVersion(write, expected), marker),
    failed: (error) =>
      isMentioned(error, marker) ? new StaleRecord(record, action, { cause: error }) : undefined,
  };
}

/**
 * `write` (which ends with its condition on the key) matching only a row at `expected`. A row
 * whose version is NULL is at 0.
 */
function withVersion(write: CompiledSql, expected: number): CompiledSql {
  const attribute = attributeFor(write.model, lockVersion);
  const column = quoteIdentifier(attribute.column);
  const params = [...write.params];
  attribute.bind(params, expected);
  const orNull = expected === 0 ? ` OR ${column} IS NULL` : "";
  return { ...write, sql: `${write.sql} AND (${column} = ${valueMark}${orNull})`, params };
}

/** Whether `error`, or an error it was caused by, says `marker` in its message. */
function isMentioned(error: unknown, marker: string): boolean {
  for (let each = error; each instanceof Error; each = each.cause) {
    if (each.message.includes(marker)) return true;
  }
  return false;
}

/** A write's statements: behind the guard when it's locked, or the write alone. */
export function lockedStatements(lock: Lock | undefined, write: CompiledSql): CompiledSql[] {
  return lock === undefined ? [write] : lock.guarded(write);
}

/** What a locked write adds to its prepared write: the `StaleRecord` its refusal throws. */
export function lockFailure(lock: Lock | undefined): Pick<PreparedWrite, "failed"> {
  return lock === undefined ? {} : { failed: lock.failed };
}

/**
 * A save's update of a record: what it writes (its changes and `stamps`, with a locked record's
 * next version in place of its own), and what the record holds once it's written beyond its own
 * changes (the stamps, and that version).
 */
export function lockedUpdate(
  lock: Lock | undefined,
  own: readonly Assignment[],
  stamps: readonly Assignment[],
): { written: Assignment[]; heldAfter: Assignment[] } {
  if (lock === undefined) return { written: [...own, ...stamps], heldAfter: [...stamps] };
  const changes = own.filter(([name]) => name !== lockVersion);
  return { written: [...changes, lock.next, ...stamps], heldAfter: [...stamps, lock.next] };
}
