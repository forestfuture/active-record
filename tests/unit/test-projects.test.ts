import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { describe, expect, test } from "vite-plus/test";

const root = new URL("../../", import.meta.url).pathname;

// Each Vitest project's folder, as vite.config.ts includes it (#286). Each adapter has its own
// folder under tests/integration/, so a test file anywhere else there would run in no project.
const projectFolders = [
  "tests/unit/",
  "tests/conformance/",
  "tests/integration/d1/",
  "tests/integration/pg/",
  "tests/remote/",
];

/** Every test file in the repository, committed or not, that git doesn't ignore. */
const testFiles = execFileSync(
  "git",
  ["ls-files", "--cached", "--others", "--exclude-standard", "--", ":(glob)tests/**/*.test.ts"],
  { cwd: root, encoding: "utf8" },
)
  .split("\n")
  .filter((file) => file !== "");

describe("the Vitest projects", () => {
  test("each folder is one vite.config.ts includes", () => {
    const config = readFileSync(`${root}vite.config.ts`, "utf8");
    for (const folder of projectFolders) expect(config).toContain(`"${folder}**/*.test.ts"`);
  });

  test("every test file sits in a project's folder, so it runs", () => {
    const outside = testFiles.filter(
      (file) => !projectFolders.some((folder) => file.startsWith(folder)),
    );
    expect(testFiles.length).toBeGreaterThan(0);
    expect(outside).toEqual([]);
  });
});
