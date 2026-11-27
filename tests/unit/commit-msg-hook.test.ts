import { spawnSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { codePointName, invisibleCharacters } from "../support/invisible-characters.ts";

// The commit-msg hook: its title length check, its wrapping of the body at 72, read past git's comments, its refusal of invisible characters, and its guard warning (#322, #329, #386, #605, #620).
const hook = new URL("../../.vite-hooks/commit-msg", import.meta.url).pathname;

/** Each file's text, or null for a file to delete. */
type Files = Record<string, string | null>;

/** A commit message: text, or bytes that needn't be UTF-8. */
type Message = string | Uint8Array;

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
 * its status, and the message as it leaves it. It runs in a UTF-8 locale.
 */
function runHook(before: Files, after: Files, message: Message, config: GitConfig = {}) {
  const dir = mkdtempSync(join(tmpdir(), "commit-msg-hook-"));
  git(dir, "init", "-q");
  for (const [key, value] of Object.entries(config)) git(dir, "config", key, value);
  write(dir, { "README.md": "x\n", ...before });
  git(dir, "add", ".");
  git(dir, "commit", "-q", "--no-gpg-sign", "-m", "Start");
  write(dir, after);
  git(dir, "add", ...Object.keys(after));
  writeFileSync(join(dir, ".git", "COMMIT_EDITMSG"), message);
  // A UTF-8 locale, where bash's [[:space:]] matches a non-breaking space and
  // ${#line} counts characters; dash, Linux's sh, does neither in any locale.
  const env = { ...process.env, LC_ALL: "en_US.UTF-8" };
  const result = spawnSync("sh", ["-e", hook, ".git/COMMIT_EDITMSG"], { cwd: dir, env });
  const written = readFileSync(join(dir, ".git", "COMMIT_EDITMSG"), "utf8");
  return { status: result.status, output: String(result.stdout), message: written };
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
  test.each(["packages/arbor/src/finders.ts", "scripts/lint/rule.mjs"])(
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
      { "packages/arbor/src/finders.test.ts": oneTest },
      { "packages/arbor/src/finders.test.ts": null, "tests/unit/finders.test.ts": oneTest },
      "Move the finder test (#1)\n",
    );

    expect(output).toBe("");
  });
});

/** Runs the hook on a commit that edits only the README. */
function runHookEditingTheReadme(message: Message, config: GitConfig = {}) {
  return runHook({}, { "README.md": "y\n" }, message, config);
}

const semicolonComments = { "core.commentChar": ";" };

/** The runs of consecutive code points in characters, in hex as the hook writes them: a0, 600-605. */
function rangesOf(characters: readonly string[]): string[] {
  const runs: [number, number][] = [];
  for (const codePoint of characters.map((character) => character.codePointAt(0)!)) {
    const last = runs.at(-1);
    if (last && last[1] === codePoint - 1) last[1] = codePoint;
    else runs.push([codePoint, codePoint]);
  }
  return runs.map(([low, high]) =>
    low === high ? low.toString(16) : `${low.toString(16)}-${high.toString(16)}`,
  );
}

/** A line of `length` characters, made of words. */
function lineOfWords(length: number): string {
  return "word ".repeat(length).slice(0, length - 1) + "x";
}

/** A line of `length` characters that can't wrap: a word, then one word too long for a line. */
function unwrappableLine(length: number): string {
  return `a ${"x".repeat(length - 2)}`;
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
    ["a carriage return, which git strips", `${lineOfWords(72)}\r`],
  ])("passes a 72-character title with %s", (_what, title) => {
    const { status, output } = runHookEditingTheReadme(`${title}\n`);

    expect(title.trimEnd()).toHaveLength(72);
    expect(status).toBe(0);
    expect(output).not.toContain("the limit is 72");
  });

  test("reads a title that opens with a byte that isn't UTF-8", () => {
    const message = Buffer.concat([Buffer.from([0xff]), Buffer.from("Edit the README (#1)\n")]);
    const { status, output } = runHookEditingTheReadme(message);

    expect(status).toBe(0);
    expect(output).toBe("");
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
  test("wraps a body line past 72 characters, keeping its words", () => {
    const line = lineOfWords(150);
    const { status, output, message } = runHookEditingTheReadme(
      `Edit the README (#1)\n\n${line}\nShort.\n`,
    );
    const lines = message.split("\n");

    expect(status).toBe(0);
    expect(output).toBe("Wrapped the commit body at 72 characters.\n");
    expect(lines.slice(0, 2)).toEqual(["Edit the README (#1)", ""]);
    expect(lines.slice(2, -2).join(" ")).toBe(line);
    expect(lines.slice(2, -2).every((wrapped) => wrapped.length <= 72)).toBe(true);
    expect(lines.slice(-2)).toEqual(["Short.", ""]);
  });

  test.each([
    ["a bullet", "- ", "  "],
    ["a numbered item", "12. ", "    "],
    ["a nested bullet", "  * ", "    "],
  ])("wraps %s under its text", (_what, lead, hang) => {
    const { message } = runHookEditingTheReadme(
      `Edit the README (#1)\n\n${lead}${lineOfWords(100)}\n`,
    );
    const lines = message.trimEnd().split("\n").slice(2);

    expect(lines[0]!.startsWith(lead)).toBe(true);
    expect(lines.slice(1).every((wrapped) => wrapped.startsWith(hang))).toBe(true);
    expect(lines.length).toBeGreaterThan(1);
  });

  test("keeps the spaces between a wrapped line's words", () => {
    const line = `Two  spaces stay.  ${lineOfWords(80)}`;
    const { message } = runHookEditingTheReadme(`Edit the README (#1)\n\n${line}\n`);

    expect(message.split("\n")[2]!.startsWith("Two  spaces stay.  word")).toBe(true);
  });

  test.each([
    ["a line indented four spaces, as code is", `    ${lineOfWords(80)}`],
    ["a line indented with a tab", `\t${lineOfWords(80)}`],
    ["a quoted line", `> ${lineOfWords(80)}`],
    ["a trailer", `Co-authored-by: ${lineOfWords(60)} <long-address@example.com>`],
  ])("leaves %s as written, and refuses it", (_what, line) => {
    const text = `Edit the README (#1)\n\n${line}\n`;
    const { status, output, message } = runHookEditingTheReadme(text);

    expect(message).toBe(text);
    expect(status).toBe(1);
    expect(output).toContain("Commit body line 3 is");
  });

  test("wraps prose that opens with a hyphenated word and a colon", () => {
    const { status, message } = runHookEditingTheReadme(
      `Edit the README (#1)\n\nFollow-up: ${lineOfWords(90)}\n`,
    );

    expect(status).toBe(0);
    expect(message.split("\n")[2]!.startsWith("Follow-up: word")).toBe(true);
    expect(message.split("\n")[3]).toMatch(/^word/);
  });

  test("leaves no file beside the message", () => {
    const dir = mkdtempSync(join(tmpdir(), "commit-msg-file-"));
    const file = join(dir, "COMMIT_EDITMSG");
    writeFileSync(file, `Edit the README (#1)\n\n${lineOfWords(80)}\n`);
    spawnSync("sh", ["-e", hook, file], { cwd: dir });

    expect(readdirSync(dir)).toEqual(["COMMIT_EDITMSG"]);
  });

  test("counts characters, not bytes, as it wraps", () => {
    const words = Array.from({ length: 30 }, () => "naïve—café").join(" ");
    const { message } = runHookEditingTheReadme(`Edit the README (#1)\n\n${words}\n`);
    const lines = message.trimEnd().split("\n").slice(2);

    expect(lines.every((wrapped) => wrapped.length <= 72)).toBe(true);
    expect(lines.slice(0, -1).every((wrapped) => wrapped.length > 60)).toBe(true);
  });

  test("refuses a long line it can't wrap, naming it", () => {
    const line = unwrappableLine(80);
    const { status, output } = runHookEditingTheReadme(`Edit the README (#1)\n\n${line}\n`);

    expect(status).toBe(1);
    expect(output).toContain("Commit body line 3 is 80 characters; wrap the body at 72:");
    expect(output).toContain(line);
  });

  test.each([
    ["blank lines before the title", `\n\nEdit the README (#1)\n\n${unwrappableLine(80)}\n`],
    ["a run of blank lines", `Edit the README (#1)\n\n\n \n${unwrappableLine(80)}\n`],
    ["a comment", `# A comment\nEdit the README (#1)\n\n${unwrappableLine(80)}\n`],
  ])("numbers a refused line as git stores the message, past %s", (_what, message) => {
    const { output } = runHookEditingTheReadme(message);

    expect(output).toContain("Commit body line 3 is 80 characters");
  });

  test("shows a refused line's backslashes as written", () => {
    const line = `a\\c b \\n ${"x".repeat(75)}`;
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
      `${lineOfWords(73)}\n\n${unwrappableLine(80)}\n`,
    );

    expect(status).toBe(1);
    expect(output).toContain("Commit title is 73 characters");
    expect(output).toContain("Commit body line 3 is 80 characters");
  });

  test("lists every long line", () => {
    const { status, output } = runHookEditingTheReadme(
      `Edit the README (#1)\n\n${unwrappableLine(80)}\nShort.\n${unwrappableLine(90)}\n`,
    );

    expect(status).toBe(1);
    expect(output).toContain("Commit body line 3 is 80 characters");
    expect(output).toContain("Commit body line 5 is 90 characters");
  });
});

describe("the commit-msg hook on invisible characters", () => {
  test("refuses one in the title, naming it and showing its line", () => {
    const { status, output } = runHookEditingTheReadme("Edit the\u00a0README (#1)\n");

    expect(status).toBe(1);
    expect(output).toContain("Commit message holds an invisible character, U+00A0, in this line:");
    expect(output).toContain("  Edit the\u00a0README (#1)\n");
  });

  test("refuses one in the body", () => {
    const { status, output } = runHookEditingTheReadme("Edit the README (#1)\n\nWhy.\u2028\n");

    expect(status).toBe(1);
    expect(output).toContain("U+2028, in this line:\n  Why.\u2028\n");
  });

  test("lists the ranges of the characters the tracked files' test refuses", () => {
    const ranges = readFileSync(hook, "utf8").match(/^invisible_ranges='([^']*)'/m)![1]!;

    expect(ranges.split(/\s+/)).toEqual(rangesOf(invisibleCharacters));
  });

  test("refuses every character the tracked files' test refuses", () => {
    const message = `Edit the README (#1)\n\n${invisibleCharacters.join("\n")}\n`;
    const { status, output } = runHookEditingTheReadme(message);
    const named = [...output.matchAll(/invisible character, (U\+[0-9A-F]+)/g)].map(
      ([, name]) => name,
    );

    expect(status).toBe(1);
    expect(named).toEqual(invisibleCharacters.map(codePointName));
  });

  test("passes the characters on each side of every range it refuses", () => {
    const listed = new Set(invisibleCharacters.map((character) => character.codePointAt(0)!));
    const neighbors = [...listed]
      .flatMap((codePoint) => [codePoint - 1, codePoint + 1])
      .filter((codePoint) => !listed.has(codePoint) && (codePoint < 0xd800 || codePoint > 0xdfff))
      .map((codePoint) => String.fromCodePoint(codePoint));
    const { status, output } = runHookEditingTheReadme(
      `Edit the README (#1)\n\n${neighbors.join("\n")}\n`,
    );

    expect(neighbors.length).toBeGreaterThan(0);
    expect(output).toBe("");
    expect(status).toBe(0);
  });

  test("passes the typographic characters a message may hold", () => {
    const { status, output } = runHookEditingTheReadme("Edit the README’s — “intro” (#1)\n");

    expect(status).toBe(0);
    expect(output).toBe("");
  });

  test("refuses one beside a long title", () => {
    const { status, output } = runHookEditingTheReadme(`${lineOfWords(73)}\n\nWhy.\ufeff\n`);

    expect(status).toBe(1);
    expect(output).toContain("Commit title is 73 characters");
    expect(output).toContain("U+FEFF");
  });

  test("passes a byte that isn't UTF-8 beside the bytes of one", () => {
    const bytes = Buffer.concat([
      Buffer.from("Edit the README (#1)\n\nWhy "),
      Buffer.from([0xc2, 0xff, 0xa0]),
      Buffer.from("\n"),
    ]);
    const { status } = runHookEditingTheReadme(new Uint8Array(bytes));

    expect(status).toBe(0);
  });

  test.each([
    ["three", [0xe0, 0x82, 0xa0]],
    ["four", [0xf0, 0x80, 0x82, 0xa0]],
  ])(
    "passes a no-break space's code point in %s overlong bytes, which aren't UTF-8",
    (_length, overlong) => {
      const bytes = Buffer.concat([
        Buffer.from("Edit the README (#1)\n\nWhy "),
        Buffer.from(overlong),
        Buffer.from("\n"),
      ]);
      const { status, output } = runHookEditingTheReadme(new Uint8Array(bytes));

      expect(status).toBe(0);
      expect(output).toBe("");
    },
  );
});
