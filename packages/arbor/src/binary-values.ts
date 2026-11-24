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

/** The character codes of the hex digits, `0`–`9` then `a`–`f`. */
const digitCodes = new TextEncoder().encode("0123456789abcdef");

const decoder = new TextDecoder();

/**
 * Bytes as hex text, two digits each, for SQL that reads bytes from JSON (`unhex`, `\\x…`). The
 * digits' character codes are written into one array and decoded once: mapping each byte to a
 * string of its own takes many times the memory and time, which a large file can't afford.
 */
export function hexOf(bytes: Uint8Array): string {
  const text = new Uint8Array(bytes.length * 2);
  // An index loop: entries() would make a pair for every byte.
  for (let index = 0; index < bytes.length; index++) {
    const byte = bytes[index]!;
    text[index * 2] = digitCodes[byte >> 4]!;
    text[index * 2 + 1] = digitCodes[byte & 15]!;
  }
  return decoder.decode(text);
}
