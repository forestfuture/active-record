import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vite-plus/test";

// The commit-msg hook's note that a tests-only commit says it adds guards (#322).
const hook = new URL("../../.vite-hooks/commit-msg", import.meta.url).pathname;

type Files = Record<string, string>;

/** Writes each file under the repository at dir. */
function write(dir: string, files: Files): void {
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(dir, path)), { recursive: true });
    writeFileSync(join(dir, path), text);
  }
}

/** Runs git in dir with a throwaway identity, and no hooks of its own. */
function git(dir: string, ...args: string[]): void {
  const identity = ["-c", "user.name=t", "-c", "user.email=t@example.invalid"];
  const result = spawnSync("git", [...identity, "-c", "core.hooksPath=/dev/null", ...args], {
    cwd: dir,
  });
  if (result.status !== 0) throw new Error(String(result.stderr));
}

/**
 * Commits `before` in a new repository, stages `after` on top of it, and
 * runs the hook on `message` as git would: what it prints, and its status.
 */
function runHook(before: Files, after: Files, message: string) {
  const dir = mkdtempSync(join(tmpdir(), "commit-msg-hook-"));
  git(dir, "init", "-q");
  write(dir, { "README.md": "x\n", ...before });
  git(dir, "add", ".");
  git(dir, "commit", "-q", "--no-gpg-sign", "-m", "Start");
  write(dir, after);
  git(dir, "add", ...Object.keys(after));
  writeFileSync(join(dir, ".git", "COMMIT_EDITMSG"), message);
  const result = spawnSync("sh", ["-e", hook, ".git/COMMIT_EDITMSG"], { cwd: dir });
  return { status: result.status, output: String(result.stdout) };
}

const oneTest = 'test("finds a record", () => {});\n';
const twoTests = `${oneTest}test("finds none", () => {});\n`;

describe("the commit-msg hook on a commit that only adds tests", () => {
  test("warns when the message doesn't say guard", () => {
    const { status, output } = runHook(
      { "tests/unit/a.test.ts": oneTest },
      { "tests/unit/a.test.ts": twoTests },
      "Test finding none (#1)\n\nCovers the empty table.\n",
    );

    expect(status).toBe(0);
    expect(output).toContain('say "guard" in the body');
  });

  test.each([
    "Guard finding none (#1)\n",
    "Test finding none (#1)\n\nA GUARD: it passed on its first run.\n",
  ])("says nothing when the message says guard: %j", (message) => {
    const { status, output } = runHook(
      { "tests/unit/a.test.ts": oneTest },
      { "tests/unit/a.test.ts": twoTests },
      message,
    );

    expect(status).toBe(0);
    expect(output).toBe("");
  });
});

describe("the commit-msg hook on a commit that adds tests and other files", () => {
  test.each(["packages/active-record/src/finders.ts", "scripts/lint/rule.mjs"])(
    "says nothing when it stages %s beside them",
    (path) => {
      const { status, output } = runHook(
        { "tests/unit/a.test.ts": oneTest },
        { "tests/unit/a.test.ts": twoTests, [path]: "export {};\n" },
        "Find none (#1)\n",
      );

      expect(status).toBe(0);
      expect(output).toBe("");
    },
  );
});
