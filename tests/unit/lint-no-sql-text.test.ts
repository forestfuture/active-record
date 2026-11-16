import noSqlText from "../../scripts/lint/no-sql-text.mjs";
import { ruleTester } from "../support/rule-tester.ts";

// A test asserts results, and SQL text only for a safety property it names (#400).
ruleTester.run("no-sql-text", noSqlText, {
  valid: [
    // Results, bound values and counts.
    "expect(events).toHaveLength(1);",
    'expect(events[0]?.params).toEqual(["admin", 1]);',
    "expect(await users.count()).toBe(4);",
  ],
  invalid: [
    {
      name: "an onQuery event's SQL",
      code: 'expect(events[0]?.sql).not.toContain("RETURNING");',
      errors: [{ messageId: "sqlText" }],
    },
    {
      name: "toSql's SQL",
      code: 'expect(User.where({ id: 1 }).toSql().sql).toContain("WHERE");',
      errors: [{ messageId: "sqlText" }],
    },
    {
      name: "SQL destructured from toSql",
      code: 'const { sql } = User.all().toSql();\nexpect(sql).toContain("1 = 0");',
      errors: [{ messageId: "sqlText" }],
    },
    {
      name: "an event's SQL, past a non-null assertion",
      code: "expect(writes[0]!.sql).toMatch(/^UPDATE/);",
      errors: [{ messageId: "sqlText" }],
    },
  ],
});
