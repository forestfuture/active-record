import sayWhatItDoes from "../../scripts/lint/say-what-it-does.mjs";
import { ruleTester } from "../support/rule-tester.ts";

// Comments and test names say what the code does, not where the idea came from
// (CODING_STANDARDS.md, Names and comments; #515).

/** The words the repo's config gives the rule. */
const options = [{ words: ["Rails"] }];

ruleTester.run("say-what-it-does", sayWhatItDoes, {
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
    "// oxlint-disable-next-line active-record/say-what-it-does -- names the Rails box\nconst a = 1;",
    "// eslint-disable-next-line active-record/say-what-it-does -- names the Rails box\nconst a = 1;",
    // An opt-out naming no rule turns every rule off, this one included.
    "// oxlint-disable-next-line -- reads the Rails box\nconst a = 1;",
  ].map((code) => ({ code, options })),
  invalid: [
    {
      name: "a line comment",
      code: "// Start at their defaults on a load, as Rails does.\nconst a = 1;",
      errors: [{ messageId: "namesOrigin" }],
    },
    {
      name: "a block comment",
      code: "/** Rails' attributes API, typed. */\nconst a = 1;",
      errors: [{ messageId: "namesOrigin" }],
    },
    {
      name: "a test's name",
      code: 'test("starts at the defaults, as Rails does", () => {});',
      errors: [{ messageId: "namesOrigin" }],
    },
    {
      name: "an it() name",
      code: 'it("keeps Rails\' order", () => {});',
      errors: [{ messageId: "namesOrigin" }],
    },
    {
      name: "a describe() name",
      code: 'describe("Rails-style callbacks", () => {});',
      errors: [{ messageId: "namesOrigin" }],
    },
    {
      name: "a test.each() name",
      code: 'test.each(["a", "b"])("reads %s as Rails does", () => {});',
      errors: [{ messageId: "namesOrigin" }],
    },
    {
      name: "a skipped test's name",
      code: 'test.skip("reads it as Rails does", () => {});',
      errors: [{ messageId: "namesOrigin" }],
    },
    {
      name: "a focused test's name",
      code: 'test.only("reads it as Rails does", () => {});',
      errors: [{ messageId: "namesOrigin" }],
    },
    {
      name: "a comment that mentions an opt-out without being one",
      code: "// Unlike oxlint-disable, this follows Rails.\nconst a = 1;",
      errors: [{ messageId: "namesOrigin" }],
    },
    {
      name: "another rule's opt-out whose reason names Rails",
      code: "// oxlint-disable-next-line no-console -- logs as Rails does\nconsole.log(1);",
      errors: [{ messageId: "namesOrigin" }],
    },
    {
      name: "a comment turning the rule back on",
      code: "// oxlint-enable active-record/say-what-it-does -- after the Rails part\nconst a = 1;",
      errors: [{ messageId: "namesOrigin" }],
    },
    {
      name: "a name given as a template literal",
      code: "test(`reads ${column} as Rails does`, () => {});",
      errors: [{ messageId: "namesOrigin" }],
    },
  ].map((invalid) => ({ ...invalid, options })),
});

// The words are the config's: any word, matched whole, with the word in the message.
ruleTester.run("say-what-it-does, given its words", sayWhatItDoes, {
  valid: [
    // With no words given, nothing is reported.
    "// Start at their defaults on a load, as Rails does.\nconst a = 1;",
    // A word's dot is a dot, not any character.
    { code: "// Reads Nodexjs.\nconst a = 1;", options: [{ words: ["Node.js"] }] },
  ],
  invalid: [
    {
      name: "each word given, named in the message",
      code: "// As Rails does.\n// As Django does.\nconst a = 1;",
      options: [{ words: ["Rails", "Django"] }],
      errors: [
        { messageId: "namesOrigin", data: { word: "Rails", place: "comment" } },
        { messageId: "namesOrigin", data: { word: "Django", place: "comment" } },
      ],
    },
    {
      name: "a word with a dot in it",
      code: 'test("reads it as Node.js does", () => {});',
      options: [{ words: ["Node.js"] }],
      errors: [{ messageId: "namesOrigin", data: { word: "Node.js", place: "test's name" } }],
    },
    {
      name: "a word ending in a symbol",
      code: "// As C++ does.\nconst a = 1;",
      options: [{ words: ["C++"] }],
      errors: [{ messageId: "namesOrigin", data: { word: "C++", place: "comment" } }],
    },
  ],
});
