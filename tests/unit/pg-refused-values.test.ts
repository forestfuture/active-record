import { describe, expect, test } from "vite-plus/test";
import { withoutRowValues } from "../../packages/active-record/src/adapters/postgresql/errors.ts";

/** A Postgres data error (SQLSTATE class 22) with `message`, as `pg` builds one. */
const dataError = (message: string) =>
  Object.assign(new Error(message), { code: "22P02", severity: "ERROR", detail: undefined });

const filtered = (message: string) => (withoutRowValues(dataError(message)) as Error).message;

// The value in a refusal is the user's, so filtering it must take time in step with its length.
describe("filtering the value Postgres refused", () => {
  test.each([
    ['invalid input value for enum mood: "a"b"', 'invalid input value for enum mood: "[FILTERED]"'],
    [
      'invalid input value for enum "Mood": "x"',
      'invalid input value for enum "Mood": "[FILTERED]"',
    ],
    [
      'invalid input value for enum app."Mo""od": "x: y"',
      'invalid input value for enum app."Mo""od": "[FILTERED]"',
    ],
    [
      'value "99999999999" is out of range for type integer',
      'value "[FILTERED]" is out of range for type integer',
    ],
  ])("%s", (message, shown) => {
    expect(filtered(message)).toBe(shown);
  });

  test("an enum refusal built to backtrack is filtered at once", { timeout: 1000 }, () => {
    const message = `invalid input value for enum "${'""'.repeat(40)} x`;

    expect(filtered(message)).not.toContain('""""');
  });
});

// Optimistic locking's guard (#357) refuses its own marker, which names the stale write.
describe("the stale guard's marker", () => {
  const marker = "active-record stale record 0b9c4b52-8f0e-4c55-9a43-2d5c6f1e7a10";

  test("stays in Postgres's refusal", () => {
    const message = `invalid input syntax for type integer: "${marker}"`;

    expect(filtered(message)).toBe(message);
  });

  test("stays in a translated refusal", () => {
    const message = `整数型の入力構文が不正です: "${marker}"`;

    expect(filtered(message)).toBe(message);
  });

  test.each([
    ["a shorter id", `"${marker.slice(0, -1)}"`],
    ["more after it", `"${marker} and more"`],
    ["more before it", `"secret ${marker}"`],
    ["another quoted value too", `"${marker}" or "secret"`],
  ])("doesn't keep a value with %s", (_, quoted) => {
    expect(filtered(`invalid input syntax for type integer: ${quoted}`)).toBe(
      'invalid input syntax for type integer: "[FILTERED]"',
    );
  });
});
