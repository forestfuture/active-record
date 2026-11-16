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
    {
      name: "each event's SQL, mapped",
      code: 'expect(events.map((event) => event.sql)).toEqual(["SELECT 1"]);',
      errors: [{ messageId: "sqlText" }],
    },
    {
      name: "a word split from each event's SQL",
      code: 'expect(events.map(({ sql }) => sql.split(" ")[1])).toEqual([\'"posts"\']);',
      errors: [{ messageId: "sqlText" }],
    },
    {
      name: "SQL returned from a block, in a pair",
      code: "expect(logged.map(({ model, sql }) => { return [model, sql]; })).toEqual([]);",
      errors: [{ messageId: "sqlText" }],
    },
    {
      name: "a test of each event's SQL with includes",
      code: "expect(events.some((event) => event.sql.includes('\"posts\"'))).toBe(true);",
      errors: [{ messageId: "sqlText" }],
    },
    {
      name: "events picked by what their SQL includes",
      code: 'expect(events.filter((event) => !event.sql.includes("SELECT"))).toHaveLength(1);',
      errors: [{ messageId: "sqlText" }],
    },
    {
      name: "SQL compared in a callback",
      code: 'expect(events.every((event) => event.sql === "SELECT 1")).toBe(true);',
      errors: [{ messageId: "sqlText" }],
    },
    {
      name: "every statement's SQL, spread and joined",
      code: 'expect([...inserted, ...events.map((e) => e.sql)].join()).not.toContain("settings");',
      errors: [{ messageId: "sqlText" }],
    },
    {
      name: "SQL in an object",
      code: "const { sql, params } = User.all().toSql();\nexpect({ sql, params }).toEqual(sent);",
      errors: [{ messageId: "sqlText" }],
    },
  ],
});
