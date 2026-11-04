import { describe, expect, test } from "vite-plus/test";
import { statementLine } from "../../packages/d1-record/cli/console/verbose.ts";

describe("a --verbose statement line", () => {
  const event = { model: "User", sql: "SELECT *", params: [], durationMs: 1.234 };

  test("names the Model, the time and the SQL", () => {
    expect(statementLine(event, false)).toBe("  User  1.2ms  SELECT *");
  });

  test("shows the bound values after the SQL", () => {
    expect(statementLine({ ...event, params: [1, "a"] }, false)).toBe(
      "  User  1.2ms  SELECT *  [ 1, 'a' ]",
    );
  });

  test("puts SQL that spans lines on one", () => {
    const sql = 'SELECT *\n  FROM "users"\n  WHERE "id" = ?';

    expect(statementLine({ ...event, sql }, false)).toBe(
      '  User  1.2ms  SELECT * FROM "users" WHERE "id" = ?',
    );
  });

  test("says failed, with the reason, in place of the time and values", () => {
    const failed = { ...event, params: [1], error: new Error("no such table") };

    expect(statementLine(failed, false)).toBe("  User  failed  SELECT *  no such table");
  });

  test("is dim only when asked", () => {
    expect(statementLine(event, true)).toBe("\u001b[2m  User  1.2ms  SELECT *\u001b[22m");
  });
});
