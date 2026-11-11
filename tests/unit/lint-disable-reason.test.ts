import { describe, test } from "vite-plus/test";
import { RuleTester } from "vite-plus/lint/plugins-dev";
import disableReason from "../../scripts/lint/disable-reason.mjs";

RuleTester.describe = describe;
RuleTester.it = test;
RuleTester.itOnly = test.only;

const tester = new RuleTester({ languageOptions: { parserOptions: { lang: "ts" } } });

// Turning off one of the repo's own rules says why, after `--` (CODING_STANDARDS.md, Tests; #302).
tester.run("disable-reason", disableReason, {
  valid: [
    "// oxlint-disable-next-line d1-record/no-fixed-delay -- the delay is what's tested\nwait();",
    // Another tool's rule, and a comment that only mentions one of the repo's rules.
    "// oxlint-disable-next-line max-lines\nwait();",
    "// d1-record/no-fixed-delay flags a timer used as a wait\nwait();",
    // Oxlint reads the reason after any `--`, spaced or not, and on the next line of a block.
    "// oxlint-disable-next-line d1-record/no-fixed-delay --the delay is what's tested\nwait();",
    "// oxlint-disable-next-line d1-record/no-fixed-delay\t--\tthe delay is what's tested\nwait();",
    "/* oxlint-disable-next-line d1-record/no-fixed-delay --\n   the delay is what's tested */\nwait();",
  ],
  invalid: [
    {
      name: "a next-line opt-out with no reason",
      code: "// oxlint-disable-next-line d1-record/no-fixed-delay\nwait();",
      errors: [{ messageId: "noReason" }],
    },
    {
      name: "an opt-out with nothing after --",
      code: "// oxlint-disable-next-line d1-record/standalone-test-name --\ntest();",
      errors: [{ messageId: "noReason" }],
    },
    {
      name: "an opt-out whose reason is only dashes",
      code: "// oxlint-disable-next-line d1-record/no-fixed-delay -- --\nwait();",
      errors: [{ messageId: "noReason" }],
    },
    {
      name: "a block comment turning a rule off for the file",
      code: "/* oxlint-disable d1-record/no-fixed-delay */\nwait();",
      errors: [{ messageId: "noReason" }],
    },
  ],
});
