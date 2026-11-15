// A binary attribute's values (#20): bytes, as a plain `Uint8Array`, from what an app assigns and what each database returns.
import { uncastable } from "./conversion.ts";

/** An assigned value as bytes: a `Uint8Array` (a `Buffer` is one) or an `ArrayBuffer`. */
export function castBinary(value: unknown): unknown {
  if (value instanceof Uint8Array) return value;
  return value instanceof ArrayBuffer ? new Uint8Array(value) : uncastable;
}

/**
 * A stored cell as a new plain `Uint8Array`: D1 returns a BLOB as an array of numbers, and `pg`
 * a `bytea` as a `Buffer`.
 */
export function readBinary(cell: unknown): unknown {
  if (cell instanceof Uint8Array) return Uint8Array.from(cell);
  return Array.isArray(cell) ? Uint8Array.from(cell as number[]) : uncastable;
}

/** Whether two stored cells are the same: bytes by content (#20), anything else by `===`. */
export function isSameCell(a: unknown, b: unknown): boolean {
  if (!(a instanceof Uint8Array && b instanceof Uint8Array)) return a === b;
  return a.length === b.length && a.every((byte, index) => byte === b[index]);
}
