import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import disableReason from "../../scripts/lint/disable-reason.mjs";
import { ruleTester } from "../support/rule-tester.ts";

const root = new URL("../../", import.meta.url).pathname;

/** The language each kind of file lint reads is parsed as. An .astro file's script is TypeScript. */
const langs = {
  ts: "ts",
  mts: "ts",
  cts: "ts",
  tsx: "tsx",
  js: "js",
  mjs: "js",
  cjs: "js",
  jsx: "jsx",
  astro: "ts",
} as const;

/** Every file lint reads, committed or not, with a comment that may turn rules off. */
const files = execFileSync(
  "git",
  [
    "grep",
    "-l",
    "--untracked",
    "-E",
    "(oxlint|eslint)-disable",
    "--",
    ...Object.keys(langs).map((extension) => `*.${extension}`),
  ],
  { cwd: root, encoding: "utf8" },
)
  .split("\n")
  .filter((file) => file !== "");

/** The code lint reads in a file: an .astro file's frontmatter, between its `---` fences. */
function codeOf(file: string): string {
  const text = readFileSync(root + file, "utf8");
  if (!file.endsWith(".astro")) return text;
  return /^---\n([\s\S]*?)\n---/.exec(text)?.[1] ?? "";
}

/** The language lint parses a file as, from its extension. */
function langOf(file: string): (typeof langs)[keyof typeof langs] {
  return langs[file.slice(file.lastIndexOf(".") + 1) as keyof typeof langs];
}

// Oxlint hides disable-reason's report on an opt-out from every rule, or from disable-reason
// itself. RuleTester applies no opt-outs, so running the rule over each file here sees them (#302).
ruleTester.run("disable-reason over the repo", disableReason, {
  valid: files.map((file) => ({
    name: file,
    filename: file,
    code: codeOf(file),
    languageOptions: { parserOptions: { lang: langOf(file) } },
  })),
  invalid: [
    {
      // If RuleTester ever applied opt-outs, this one would hide its own report, and every
      // file above would pass whatever it held. This case going red is what shows it.
      name: "an opt-out from every rule for the whole file, which Oxlint hides",
      code: "/* oxlint-disable */\nwait();",
      errors: [{ messageId: "noReason" }],
    },
  ],
});
