import { existsSync, readFileSync } from "node:fs";
import { execFileSync } from "node:child_process";
import { describe, expect, test } from "vite-plus/test";

const root = new URL("../../", import.meta.url).pathname;

/** The docs a reader follows links from: the guide, the READMEs, the skill, and docs/. */
const docs = execFileSync(
  "git",
  [
    "ls-files",
    "site/docs",
    "README.md",
    "packages/*/README.md",
    "packages/*/skills",
    "docs",
    "CONTRIBUTING.md",
    "GLOSSARY.md",
  ],
  { cwd: root, encoding: "utf8" },
)
  .split("\n")
  .filter((file) => /\.(md|mdx)$/.test(file));

// A link to a file in this repository on GitHub breaks silently when the file moves (#267's tests).
describe("links to the repository's own files", () => {
  test("name files that exist", () => {
    const missing = docs.flatMap((file) =>
      [
        ...readFileSync(`${root}${file}`, "utf8").matchAll(
          /github\.com\/forestfuture\/(?:d1-record|active-record)\/(?:blob|tree)\/main\/([^)\s"#>]+)/g,
        ),
      ]
        .map(([, path]) => decodeURIComponent(path!))
        .filter((path) => !existsSync(`${root}${path}`))
        .map((path) => `${file}: ${path}`),
    );

    expect(missing).toEqual([]);
  });
});
