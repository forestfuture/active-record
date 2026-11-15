import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vite-plus/test";

// The commit-msg hook: its title and body length checks, read past git's comments, and its guard warning (#322, #329, #386).
const hook = new URL("../../.vite-hooks/commit-msg", import.meta.url).pathname;

/** Each file's text, or null for a file to delete. */
type Files = Record<string, string | null>;

/** git config settings, set in the order given. */
type GitConfig = Record<string, string>;

/** Writes or deletes each file under the repository at dir. */
function write(dir: string, files: Files): void {
  for (const [path, text] of Object.entries(files)) {
    if (text === null) {
      rmSync(join(dir, path));
      continue;
    }
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
 * Commits `before` in a new repository with `config` set, stages `after` on
 * top of it, and runs the hook on `message` as git would: what it prints,
 * and its status. It runs in the C locale.
 */
function runHook(before: Files, after: Files, message: string, config: GitConfig = {}) {
  const dir = mkdtempSync(join(tmpdir(), "commit-msg-hook-"));
  git(dir, "init", "-q");
  for (const [key, value] of Object.entries(config)) git(dir, "config", key, value);
  write(dir, { "README.md": "x\n", ...before });
  git(dir, "add", ".");
  git(dir, "commit", "-q", "--no-gpg-sign", "-m", "Start");
  write(dir, after);
  git(dir, "add", ...Object.keys(after));
  writeFileSync(join(dir, ".git", "COMMIT_EDITMSG"), message);
  // In the C locale, as dash in any locale, the shell measures text in bytes.
  const env = { ...process.env, LC_ALL: "C" };
  const result = spawnSync("sh", ["-e", hook, ".git/COMMIT_EDITMSG"], { cwd: dir, env });
  return { status: result.status, output: String(result.stdout) };
}

const oneTest = 'test("finds a record", () => {});\n';
const twoTests = `${oneTest}test("finds none", () => {});\n`;
/** What `git commit -v` puts below a message: a scissors line, then the diff. */
const verboseDiff = [
  "# ------------------------ >8 ------------------------",
  "# Do not modify or remove the line above.",
  "diff --git a/tests/unit/a.test.ts b/tests/unit/a.test.ts",
  '+test("guards none", () => {});',
  "",
].join("\n");

/** Runs the hook on a commit that adds a second test to tests/unit/a.test.ts. */
function runHookAddingATest(message: string, config: GitConfig = {}) {
  return runHook(
    { "tests/unit/a.test.ts": oneTest },
    { "tests/unit/a.test.ts": twoTests },
    message,
    config,
  );
}

describe("the commit-msg hook on a commit that only adds tests", () => {
  test("warns when the message doesn't say guard", () => {
    const { status, output } = runHookAddingATest(
      "Test finding none (#1)\n\nCovers the empty table.\n",
    );

    expect(status).toBe(0);
    expect(output).toContain('say "guard" in the body');
  });

  test.each([
    "Guard finding none (#1)\n",
    "Test finding none (#1)\n\nA GUARD: it passed on its first run.\n",
  ])("says nothing when the message says guard: %j", (message) => {
    const { status, output } = runHookAddingATest(message);

    expect(status).toBe(0);
    expect(output).toBe("");
  });

  test.each([
    ["a comment", "Test finding none (#1)\n\n# guard\n"],
    ["git commit -v's diff", `Test finding none (#1)\n\n${verboseDiff}`],
  ])("warns when guard is only in %s", (_where, message) => {
    const { output } = runHookAddingATest(message);

    expect(output).toContain('say "guard" in the body');
  });

  test.each([
    ["a comment", "Test finding none (#1)\n\n; guard\n"],
    ["git commit -v's diff", `Test finding none (#1)\n\n${verboseDiff.replaceAll("# ", "; ")}`],
  ])("warns when guard is only in %s with ; as git's comment character", (_where, message) => {
    const { output } = runHookAddingATest(message, { "core.commentChar": ";" });

    expect(output).toContain('say "guard" in the body');
  });

  test("warns when guard is only part of a longer word", () => {
    const { output } = runHookAddingATest(
      "Test finding none (#1)\n\nA safeguard for empty tables.\n",
    );

    expect(output).toContain('say "guard" in the body');
  });

  test("warns when a test file's name holds a quote", () => {
    const { output } = runHook(
      { 'tests/unit/a"b.test.ts': oneTest },
      { 'tests/unit/a"b.test.ts': twoTests },
      "Test finding none (#1)\n",
    );

    expect(output).toContain('say "guard" in the body');
  });

  test("warns when git colors its diffs", () => {
    const { output } = runHookAddingATest("Test finding none (#1)\n", { "color.diff": "always" });

    expect(output).toContain('say "guard" in the body');
  });

  test("warns when git quotes a test file's non-ASCII name", () => {
    const { output } = runHook(
      { "tests/unit/café.test.ts": oneTest },
      { "tests/unit/café.test.ts": twoTests },
      "Test finding none (#1)\n",
      { "core.quotePath": "true" },
    );

    expect(output).toContain('say "guard" in the body');
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

describe("the commit-msg hook on a commit that renames or moves tests", () => {
  test("says nothing when it renames one", () => {
    const renamed = oneTest.replace("finds a record", "finds the record");
    const { output } = runHook(
      { "tests/unit/a.test.ts": oneTest },
      { "tests/unit/a.test.ts": renamed },
      "Name the finder test (#1)\n",
    );

    expect(output).toBe("");
  });

  test("says nothing when it moves one to another file", () => {
    const { output } = runHook(
      { "tests/unit/a.test.ts": twoTests },
      { "tests/unit/a.test.ts": oneTest, "tests/unit/b.test.ts": twoTests.replace(oneTest, "") },
      "Move the empty-table test (#1)\n",
    );

    expect(output).toBe("");
  });

  test("says nothing when it moves one into tests/ from another folder", () => {
    const { output } = runHook(
      { "packages/active-record/src/finders.test.ts": oneTest },
      { "packages/active-record/src/finders.test.ts": null, "tests/unit/finders.test.ts": oneTest },
      "Move the finder test (#1)\n",
    );

    expect(output).toBe("");
  });
});

/** Runs the hook on a commit that edits only the README. */
function runHookEditingTheReadme(message: string, config: GitConfig = {}) {
  return runHook({}, { "README.md": "y\n" }, message, config);
}

const semicolonComments = { "core.commentChar": ";" };

/** A line of `length` characters, made of words. */
function lineOfWords(length: number): string {
  return "word ".repeat(length).slice(0, length - 1) + "x";
}

describe("the commit-msg hook on a commit's title", () => {
  test("skips a long comment line that opens with git's comment character", () => {
    const { status, output } = runHookEditingTheReadme(
      `; ${"x".repeat(80)}\nEdit the README (#1)\n`,
      semicolonComments,
    );

    expect(status).toBe(0);
    expect(output).toBe("");
  });

  test("refuses a long title that opens with # when git's comment character is ;", () => {
    const { status, output } = runHookEditingTheReadme(
      `#1 ${"x".repeat(80)}\nShort (#1)\n`,
      semicolonComments,
    );

    expect(status).toBe(1);
    expect(output).toContain("the limit is 72");
  });

  test.each([
    ["commentChar", ";", { "core.commentString": "//", "core.commentChar": ";" }],
    ["commentString", "//", { "core.commentChar": ";", "core.commentString": "//" }],
  ])("skips comment lines in %s's %s when git reads it last", (_key, comment, config) => {
    const { status, output } = runHookEditingTheReadme(
      `${comment} ${"x".repeat(80)}\nEdit the README (#1)\n`,
      config,
    );

    expect(status).toBe(0);
    expect(output).toBe("");
  });

  test("skips a long # comment line when commentChar is AUTO", () => {
    const { status, output } = runHookEditingTheReadme(
      `# ${"x".repeat(80)}\nEdit the README (#1)\n`,
      { "core.commentChar": "AUTO" },
    );

    expect(status).toBe(0);
    expect(output).toBe("");
  });

  test.each([
    ["em dashes, counting characters", `${lineOfWords(68)} — —`],
    ["trailing spaces, which git strips", `${lineOfWords(72)}   `],
  ])("passes a 72-character title with %s", (_what, title) => {
    const { status, output } = runHookEditingTheReadme(`${title}\n`);

    expect(status).toBe(0);
    expect(output).not.toContain("the limit is 72");
  });

  test("shows a refused title's backslashes as written", () => {
    const title = `${lineOfWords(70)} a\\c b \\n c`;
    const { output } = runHookEditingTheReadme(`${title}\n`);

    expect(output).toContain(`  ${title}\n`);
  });

  test("skips a long # comment line by default", () => {
    const { status, output } = runHookEditingTheReadme(
      `# ${"x".repeat(80)}\nEdit the README (#1)\n`,
    );

    expect(status).toBe(0);
    expect(output).toBe("");
  });
});

describe("the commit-msg hook on a commit's body", () => {
  test("refuses a body line past 72 characters, naming it", () => {
    const line = lineOfWords(73);
    const { status, output } = runHookEditingTheReadme(`Edit the README (#1)\n\n${line}\n`);

    expect(status).toBe(1);
    expect(output).toContain("Commit body line 3 is 73 characters; wrap the body at 72:");
    expect(output).toContain(line);
  });

  test.each([
    ["blank lines before the title", `\n\nEdit the README (#1)\n\n${lineOfWords(73)}\n`],
    ["a run of blank lines", `Edit the README (#1)\n\n\n \n${lineOfWords(73)}\n`],
    ["a comment", `# A comment\nEdit the README (#1)\n\n${lineOfWords(73)}\n`],
  ])("numbers a refused line as git stores the message, past %s", (_what, message) => {
    const { output } = runHookEditingTheReadme(message);

    expect(output).toContain("Commit body line 3 is 73 characters");
  });

  test("shows a refused line's backslashes as written", () => {
    const line = `${lineOfWords(70)} a\\c b \\n c`;
    const { output } = runHookEditingTheReadme(`Edit the README (#1)\n\n${line}\n`);

    expect(output).toContain(`  ${line}\n`);
  });

  test("passes a body line of 72 characters", () => {
    const { status, output } = runHookEditingTheReadme(
      `Edit the README (#1)\n\n${lineOfWords(72)}\n`,
    );

    expect(status).toBe(0);
    expect(output).toBe("");
  });

  test("counts a body line's characters, not its bytes", () => {
    const line = `${lineOfWords(68)} — —`;
    const { status, output } = runHookEditingTheReadme(`Edit the README (#1)\n\n${line}\n`);

    expect(line).toHaveLength(72);
    expect(status).toBe(0);
    expect(output).toBe("");
  });

  test.each([
    ["trailing spaces", "   "],
    ["a carriage return", "\r"],
  ])("passes a 72-character body line followed by %s, which git strips", (_what, end) => {
    const { status, output } = runHookEditingTheReadme(
      `Edit the README (#1)\n\n${lineOfWords(72)}${end}\n`,
    );

    expect(status).toBe(0);
    expect(output).toBe("");
  });

  const url = `https://example.com/${"x".repeat(80)}`;

  test.each([
    ["a URL alone", url],
    ["an indented URL alone", `    ${url}`],
    ["a URL among words", `See ${url} for why.`],
    ["a line with no space", "x".repeat(80)],
    ["an indented line with no space", `  -${"x".repeat(80)}`],
  ])("passes a long line that can't wrap: %s", (_what, line) => {
    const { status, output } = runHookEditingTheReadme(`Edit the README (#1)\n\n${line}\n`);

    expect(status).toBe(0);
    expect(output).toBe("");
  });

  test.each([
    ["a comment", `Edit the README (#1)\n\n# ${lineOfWords(80)}\n`],
    ["git commit -v's diff", `Edit the README (#1)\n\n${verboseDiff}+${lineOfWords(80)}\n`],
  ])("skips a long line in %s", (_where, message) => {
    const { status, output } = runHookEditingTheReadme(message);

    expect(status).toBe(0);
    expect(output).toBe("");
  });

  test("lists long body lines beside a long title", () => {
    const { status, output } = runHookEditingTheReadme(
      `${lineOfWords(73)}\n\n${lineOfWords(73)}\n`,
    );

    expect(status).toBe(1);
    expect(output).toContain("Commit title is 73 characters");
    expect(output).toContain("Commit body line 3 is 73 characters");
  });

  test("refuses a long indented line that has spaces", () => {
    const { status, output } = runHookEditingTheReadme(
      `Edit the README (#1)\n\n    ${lineOfWords(73)}\n`,
    );

    expect(status).toBe(1);
    expect(output).toContain("Commit body line 3 is 77 characters");
  });

  test("lists every long line", () => {
    const { status, output } = runHookEditingTheReadme(
      `Edit the README (#1)\n\n${lineOfWords(73)}\nShort.\n${lineOfWords(80)}\n`,
    );

    expect(status).toBe(1);
    expect(output).toContain("Commit body line 3 is 73 characters");
    expect(output).toContain("Commit body line 5 is 80 characters");
  });
});
