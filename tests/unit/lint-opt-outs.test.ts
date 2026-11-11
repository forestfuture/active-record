import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import disableReason from "../../scripts/lint/disable-reason.mjs";
import { ruleTester } from "../support/rule-tester.ts";

const root = new URL("../../", import.meta.url).pathname;

/** Every source file lint reads, committed or not, with a comment that may turn rules off. */
const files = execFileSync(
  "git",
  [
    "grep",
    "-l",
    "--untracked",
    "-E",
    "(oxlint|eslint)-disable",
    "--",
    "*.ts",
    "*.mts",
    "*.cts",
    "*.js",
    "*.mjs",
    "*.cjs",
  ],
  { cwd: root, encoding: "utf8" },
)
  .split("\n")
  .filter((file) => file !== "");

// Oxlint hides disable-reason's report on an opt-out from every rule, or from disable-reason
// itself. RuleTester applies no opt-outs, so running the rule over each file here sees them (#302).
ruleTester.run("disable-reason over the repo", disableReason, {
  valid: files.map((file) => ({
    name: file,
    filename: file,
    code: readFileSync(root + file, "utf8"),
  })),
  invalid: [],
});
