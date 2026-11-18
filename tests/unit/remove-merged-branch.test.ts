import { spawnSync } from "node:child_process";
import { chmodSync, existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";

// scripts/remove-merged-branch.mjs: removes an issue branch and its worktree once its pull request is merged (#484).
const script = new URL("../../scripts/remove-merged-branch.mjs", import.meta.url).pathname;

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

/** A repository with a commit on main, and a branch checked out in a worktree with one commit. */
function repository(branch: string): { dir: string; worktree: string; tip: string } {
  const dir = mkdtempSync(join(tmpdir(), "remove-merged-branch-"));
  git(dir, "init", "-q", "-b", "main");
  git(dir, "commit", "-q", "--allow-empty", "-m", "start");
  const worktree = join(dir, "wt", branch);
  git(dir, "worktree", "add", "-q", "-b", branch, worktree);
  git(worktree, "commit", "-q", "--allow-empty", "-m", "work");
  return { dir, worktree, tip: git(worktree, "rev-parse", "HEAD") };
}

/** A gh stand-in that answers only a query for 7-thing's merged pull requests, with merged. */
function fakeGh(merged: Array<{ number: number; headRefOid: string }>): string {
  const bin = mkdtempSync(join(tmpdir(), "fake-gh-"));
  const gh = join(bin, "gh");
  const query = "pr list --head 7-thing --state merged --json number,headRefOid";
  const answer = `printf '%s' '${JSON.stringify(merged)}'`;
  writeFileSync(gh, `#!/bin/sh\n[ "$*" = "${query}" ] || exit 3\n${answer}\n`);
  chmodSync(gh, 0o755);
  return bin;
}

/** Runs the script in dir for branch, with gh answering from bin. */
function run(dir: string, branch: string, bin: string) {
  return spawnSync("node", [script, branch], {
    cwd: dir,
    encoding: "utf8",
    env: { ...process.env, PATH: `${bin}:${process.env.PATH}` },
  });
}

/** Whether dir's repository still has branch. */
function hasBranch(dir: string, branch: string): boolean {
  return git(dir, "branch", "--list", branch) !== "";
}

describe("remove-merged-branch", () => {
  test("removes a merged branch and its worktree", () => {
    const { dir, worktree, tip } = repository("7-thing");

    const result = run(dir, "7-thing", fakeGh([{ number: 9, headRefOid: tip }]));

    expect(result.status).toBe(0);
    expect(existsSync(worktree)).toBe(false);
    expect(hasBranch(dir, "7-thing")).toBe(false);
  });

  test("keeps a branch whose pull request isn't merged", () => {
    const { dir, worktree } = repository("7-thing");

    const result = run(dir, "7-thing", fakeGh([]));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("no merged pull request");
    expect(existsSync(worktree)).toBe(true);
    expect(hasBranch(dir, "7-thing")).toBe(true);
  });

  test("keeps a branch with commits its merged pull request didn't have", () => {
    const { dir, worktree, tip } = repository("7-thing");
    git(worktree, "commit", "-q", "--allow-empty", "-m", "after the merge");

    const result = run(dir, "7-thing", fakeGh([{ number: 9, headRefOid: tip }]));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("isn't the head of a merged pull request");
    expect(hasBranch(dir, "7-thing")).toBe(true);
  });

  test("keeps a worktree with uncommitted changes", () => {
    const { dir, worktree, tip } = repository("7-thing");
    writeFileSync(join(worktree, "draft.txt"), "x");

    const result = run(dir, "7-thing", fakeGh([{ number: 9, headRefOid: tip }]));

    expect(result.status).toBe(1);
    expect(existsSync(join(worktree, "draft.txt"))).toBe(true);
    expect(hasBranch(dir, "7-thing")).toBe(true);
  });

  test("refuses a branch that isn't an issue branch", () => {
    const { dir } = repository("7-thing");

    const result = run(dir, "main", fakeGh([]));

    expect(result.status).toBe(1);
    expect(result.stderr).toContain("<issue>-<slug>");
    expect(hasBranch(dir, "main")).toBe(true);
  });
});
