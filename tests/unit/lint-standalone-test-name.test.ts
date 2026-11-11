import { describe, test } from "vite-plus/test";
import { RuleTester } from "vite-plus/lint/plugins-dev";
import standaloneTestName from "../../scripts/lint/standalone-test-name.mjs";

RuleTester.describe = describe;
RuleTester.it = test;
RuleTester.itOnly = test.only;

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });

// A test's name stands alone, with nothing leaning on a sibling (CODING_STANDARDS.md, Tests; #302).
tester.run("standalone-test-name", standaloneTestName, {
  valid: ['test("redirects HEAD", () => {});'],
  invalid: [
    {
      name: '"too" in a test name',
      code: 'test("redirects HEAD too", () => {});',
      errors: [{ messageId: "leans" }],
    },
  ],
});
