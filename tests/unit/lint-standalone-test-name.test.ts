import { describe, test } from "vite-plus/test";
import { RuleTester } from "vite-plus/lint/plugins-dev";
import standaloneTestName from "../../scripts/lint/standalone-test-name.mjs";

RuleTester.describe = describe;
RuleTester.it = test;
RuleTester.itOnly = test.only;

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });

// A test's name stands alone, with nothing leaning on a sibling (CODING_STANDARDS.md, Tests; #302).
tester.run("standalone-test-name", standaloneTestName, {
  valid: [
    'test("redirects HEAD", () => {});',
    // A string that isn't a test's name: an assertion's value, and a test.each() table.
    'expect(message).toBe("too many");',
    'test.each(["too"])("reads %s", () => {});',
  ],
  invalid: [
    {
      name: '"too" in a test name',
      code: 'test("redirects HEAD too", () => {});',
      errors: [{ messageId: "leans" }],
    },
    {
      name: "an it() name",
      code: 'it("redirects HEAD too", () => {});',
      errors: [{ messageId: "leans" }],
    },
    {
      name: "a test.each() name",
      code: 'test.each(["GET", "HEAD"])("redirects %s too", () => {});',
      errors: [{ messageId: "leans" }],
    },
    {
      name: "a name given as a template literal",
      code: "test(`redirects ${method} too`, () => {});",
      errors: [{ messageId: "leans" }],
    },
    {
      name: "a skipped test's name",
      code: 'test.skip("redirects HEAD too", () => {});',
      errors: [{ messageId: "leans" }],
    },
    {
      name: "a conditional test's name",
      code: 'test.skipIf(!url)("redirects HEAD too", () => {});',
      errors: [{ messageId: "leans" }],
    },
  ],
});
