// What counts as blank for `presence`, `absence` and `comparison`: null, or a string that's only whitespace.

/** Null, or a string that's empty after trimming. */
export function isBlank(value: unknown): boolean {
  return value === null || (typeof value === "string" && value.trim() === "");
}
