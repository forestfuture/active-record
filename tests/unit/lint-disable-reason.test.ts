import disableReason from "../../scripts/lint/disable-reason.mjs";
import { ruleTester } from "../support/rule-tester.ts";

// Turning off one of the repo's own rules says why, after `--` (CODING_STANDARDS.md, Tests; #302).
ruleTester.run("disable-reason", disableReason, {
  valid: [
    "// oxlint-disable-next-line d1-record/no-fixed-delay -- the delay is what's tested\nwait();",
    // Another tool's rule, and a comment that only mentions one of the repo's rules.
    "// oxlint-disable-next-line max-lines\nwait();",
    "// d1-record/no-fixed-delay flags a timer used as a wait\nwait();",
    // Not a directive Oxlint reads, and another plugin's rule whose name ends the same way.
    "// oxlint-disable-nextline d1-record/no-fixed-delay\nwait();",
    "// oxlint-disable-next-line other-d1-record/no-fixed-delay\nwait();",
    // Oxlint reads the reason after any `--`, spaced or not, and on the next line of a block.
    "// oxlint-disable-next-line d1-record/no-fixed-delay --the delay is what's tested\nwait();",
    "// oxlint-disable-next-line d1-record/no-fixed-delay\t--\tthe delay is what's tested\nwait();",
    "/* oxlint-disable-next-line d1-record/no-fixed-delay --\n   the delay is what's tested */\nwait();",
    "// oxlint-disable-next-line -- generated code\nwait();",
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
      name: "an opt-out naming no rule, so turning off every rule",
      code: "// oxlint-disable-next-line\nwait();",
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
