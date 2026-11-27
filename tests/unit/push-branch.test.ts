import { spawnSync } from "node:child_process";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";

// scripts/push-branch.mjs: pushes the checked-out issue branch to its namesake on origin, with a lease (#620).
const script = new URL("../../scripts/push-branch.mjs", import.meta.url).pathname;

/** Runs git in dir with a throwaway identity, and no hooks, returning its trimmed output. */
function git(dir: string, ...args: string[]): string {
  const identity = [
    "-c",
    "user.name=t",
    "-c",
    "user.email=t@example.invalid",
    "-c",
    "commit.gpgsign=false",
  ];
  const result = spawnSync("git", [...identity, "-c", "core.hooksPath=/dev/null", ...args], {
    cwd: dir,
    encoding: "utf8",
  });
  if (result.status !== 0) throw new Error(result.stderr);
  return result.stdout.trim();
}

/** A clone of a bare origin, with a commit on main pushed, checked out on branch. */
function clone(branch: string): { dir: string; origin: string } {
  const origin = mkdtempSync(join(tmpdir(), "push-branch-origin-"));
  git(origin, "init", "-q", "--bare", "-b", "main");
  const dir = mkdtempSync(join(tmpdir(), "push-branch-"));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "remote", "add", "origin", origin);
  git(dir, "commit", "-q", "--allow-empty", "-m", "start");
  git(dir, "push", "-q", "origin", "main:main");
  if (branch !== "main") git(dir, "switch", "-q", "-c", branch);
  return { dir, origin };
}

/** Runs the script in dir. */
function run(dir: string) {
  return spawnSync("node", [script], { cwd: dir, encoding: "utf8" });
}

describe("scripts/push-branch.mjs", () => {
  test("pushes a new issue branch and tracks it", () => {
    const { dir, origin } = clone("7-thing");
    git(dir, "commit", "-q", "--allow-empty", "-m", "work");

    expect(run(dir).status).toBe(0);
    expect(git(origin, "rev-parse", "7-thing")).toBe(git(dir, "rev-parse", "HEAD"));
    expect(git(dir, "rev-parse", "--abbrev-ref", "@{upstream}")).toBe("origin/7-thing");
  });

  test("pushes a rebased issue branch over its old tip", () => {
    const { dir, origin } = clone("7-thing");
    git(dir, "commit", "-q", "--allow-empty", "-m", "work");
    expect(run(dir).status).toBe(0);
    git(dir, "commit", "-q", "--amend", "--allow-empty", "-m", "reworded");

    expect(run(dir).status).toBe(0);
    expect(git(origin, "rev-parse", "7-thing")).toBe(git(dir, "rev-parse", "HEAD"));
  });

  test("refuses when origin's branch moved since this clone last saw it", () => {
    const { dir, origin } = clone("7-thing");
    git(dir, "commit", "-q", "--allow-empty", "-m", "work");
    expect(run(dir).status).toBe(0);
    const other = mkdtempSync(join(tmpdir(), "push-branch-other-"));
    git(other, "clone", "-q", "-b", "7-thing", origin, ".");
    git(other, "commit", "-q", "--allow-empty", "-m", "theirs");
    git(other, "push", "-q", "origin", "7-thing:7-thing");
    const theirs = git(other, "rev-parse", "HEAD");
    git(dir, "commit", "-q", "--amend", "--allow-empty", "-m", "reworded");

    expect(run(dir).status).not.toBe(0);
    expect(git(origin, "rev-parse", "7-thing")).toBe(theirs);
  });

  test("refuses when origin's branch holds a commit this branch never had, though fetched", () => {
    const { dir, origin } = clone("7-thing");
    git(dir, "commit", "-q", "--allow-empty", "-m", "work");
    expect(run(dir).status).toBe(0);
    const other = mkdtempSync(join(tmpdir(), "push-branch-other-"));
    git(other, "clone", "-q", "-b", "7-thing", origin, ".");
    git(other, "commit", "-q", "--allow-empty", "-m", "theirs");
    git(other, "push", "-q", "origin", "7-thing:7-thing");
    const theirs = git(other, "rev-parse", "HEAD");
    git(dir, "fetch", "-q", "origin");
    git(dir, "commit", "-q", "--amend", "--allow-empty", "-m", "reworded");

    expect(run(dir).status).not.toBe(0);
    expect(git(origin, "rev-parse", "7-thing")).toBe(theirs);
  });

  test.each(["main", "feature", "claude/retro"])("refuses to push %j", (branch) => {
    const { dir, origin } = clone(branch);
    const before = git(origin, "rev-parse", "main");
    git(dir, "commit", "-q", "--allow-empty", "-m", "work");

    const result = run(dir);

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("<issue>-<slug>");
    expect(git(origin, "rev-parse", "main")).toBe(before);
  });
});
