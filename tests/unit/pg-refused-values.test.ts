import { describe, expect, test } from "vite-plus/test";
import { withoutRowValues } from "../../packages/pg-record/src/errors.ts";

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
