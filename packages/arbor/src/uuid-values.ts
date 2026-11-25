// A uuid attribute's values (#507): a UUID in one form, lowercase with hyphens, from what an app assigns and what each database returns.
import { uncastable } from "./conversion.ts";

/**
 * A UUID's digits as Postgres reads them, once `castUuid` has taken off any braces: 32 hex digits
 * in any case, a hyphen allowed after any group of four but the last. Every count is fixed, so a
 * long string fails without backtracking far.
 */
const uuidText = /^(?:[0-9a-f]{4}-?){7}[0-9a-f]{4}$/i;

/** Where the canonical form's hyphens go: after the 8th, 12th, 16th and 20th digits. */
const groups = /^(.{8})(.{4})(.{4})(.{4})(.{12})$/;

/**
 * Text that's a UUID, in its one form (`"0b6f8a1e-3c2d-4e5f-9a7b-1c2d3e4f5a6b"`), as Postgres
 * writes a `uuid`, so a value assigned in capitals or braces isn't a change, and a condition with
 * one finds the row; anything else, a number included, is `uncastable`.
 */
export function castUuid(value: unknown): unknown {
  if (typeof value !== "string") return uncastable;
  const braced = value.startsWith("{") && value.endsWith("}");
  const inner = braced ? value.slice(1, -1) : value;
  if (!uuidText.test(inner)) return uncastable;
  return inner.replaceAll("-", "").toLowerCase().replace(groups, "$1-$2-$3-$4-$5");
}

/**
 * A stored cell, only in its one form, as Postgres returns a `uuid`; any other is `uncastable`.
 * A D1 TEXT key in capitals would otherwise be held in lowercase, and its record's writes, which
 * find their row by the key held, would miss it, since D1 compares text exactly.
 */
export function readUuid(value: unknown): unknown {
  return castUuid(value) === value ? value : uncastable;
}
