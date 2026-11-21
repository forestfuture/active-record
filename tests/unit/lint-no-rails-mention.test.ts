import noRailsMention from "../../scripts/lint/no-rails-mention.mjs";
import { ruleTester } from "../support/rule-tester.ts";

// Comments and test names say what the code does, not where the idea came from
// (CODING_STANDARDS.md, Names and comments; #515).
ruleTester.run("no-rails-mention", noRailsMention, {
  valid: [
    "// Start at their defaults on a load.\nconst a = 1;",
    // The word in lower case is ordinary English, and a longer word isn't it.
    "// A default scope keeps its guard rails.\nconst a = 1;",
    "// The guardrails stay on.\nconst a = 1;",
    // Code that isn't a comment or a test's name: a string, a regex, an identifier.
    'expect(title).toBe("Compared with Rails");',
    "const box = /(Compared with|Beyond) Rails/;",
    "const Rails = 1;",
    // An opt-out's reason can name what it opts out for.
    "// oxlint-disable-next-line active-record/no-rails-mention -- names the Rails box\nconst a = 1;",
    "// eslint-disable-next-line active-record/no-rails-mention -- names the Rails box\nconst a = 1;",
  ],
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
      name: "a focused test's name",
      code: 'test.only("reads it as Rails does", () => {});',
      errors: [{ messageId: "mentionsRails" }],
    },
    {
      name: "a comment that mentions an opt-out without being one",
      code: "// Unlike oxlint-disable, this follows Rails.\nconst a = 1;",
      errors: [{ messageId: "mentionsRails" }],
    },
    {
      name: "another rule's opt-out whose reason names Rails",
      code: "// oxlint-disable-next-line no-console -- logs as Rails does\nconsole.log(1);",
      errors: [{ messageId: "mentionsRails" }],
    },
    {
      name: "a name given as a template literal",
      code: "test(`reads ${column} as Rails does`, () => {});",
      errors: [{ messageId: "mentionsRails" }],
    },
  ],
});
