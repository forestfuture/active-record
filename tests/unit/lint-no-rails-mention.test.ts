import noRailsMention from "../../scripts/lint/no-rails-mention.mjs";
import { ruleTester } from "../support/rule-tester.ts";

// Comments and test names say what the code does, not where the idea came from
// (CODING_STANDARDS.md, Coding; #515).
ruleTester.run("no-rails-mention", noRailsMention, {
  valid: ["// Start at their defaults on a load.\nconst a = 1;"],
  invalid: [
    {
      name: "a line comment",
      code: "// Start at their defaults on a load, as Rails does.\nconst a = 1;",
      errors: [{ messageId: "mentionsRails" }],
    },
    {
      name: "a block comment",
      code: "/** Rails' attributes API, typed. */\nconst a = 1;",
      errors: [{ messageId: "mentionsRails" }],
    },
    {
      name: "a test's name",
      code: 'test("starts at the defaults, as Rails does", () => {});',
      errors: [{ messageId: "mentionsRails" }],
    },
    {
      name: "an it() name",
      code: 'it("keeps Rails\' order", () => {});',
      errors: [{ messageId: "mentionsRails" }],
    },
    {
      name: "a describe() name",
      code: 'describe("Rails-style callbacks", () => {});',
      errors: [{ messageId: "mentionsRails" }],
    },
    {
      name: "a test.each() name",
      code: 'test.each(["a", "b"])("reads %s as Rails does", () => {});',
      errors: [{ messageId: "mentionsRails" }],
    },
    {
      name: "a skipped test's name",
      code: 'test.skip("reads it as Rails does", () => {});',
      errors: [{ messageId: "mentionsRails" }],
    },
    {
      name: "a name given as a template literal",
      code: "test(`reads ${column} as Rails does`, () => {});",
      errors: [{ messageId: "mentionsRails" }],
    },
  ],
});
