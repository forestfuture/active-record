import { spawnSync } from "node:child_process";
import { describe, expect, test } from "vite-plus/test";

// The PreToolUse hook that stops an agent staging everything or throwing work away (#302 retro), and lets it force-push its own issue branch (#484).
const hook = new URL("../../.claude/hooks/block-dangerous-git.sh", import.meta.url).pathname;

/** The hook's exit status for a Bash command: 2 blocks it, 0 lets it run. */
function statusFor(command: string): number | null {
  const input = JSON.stringify({ tool_input: { command } });
  return spawnSync(hook, { input }).status;
}

describe("the git guard hook", () => {
  test.each([
    "git add -A",
    "git add .",
    "git add -- .",
    "git add -u",
    "cd x && git add --all",
    "git commit -am x",
    "git commit -q -a -m x",
    "git reset --hard HEAD",
    "git clean -fd",
    "git branch -D old",
    "git checkout .",
    "git restore .",
    "git push --force-with-lease",
    "git push -f origin 24-joins:24-joins",
    "git push --force origin 24-joins:24-joins",
    "git push --force-with-lease origin main:main",
    "git push --force-with-lease origin 24-joins:main",
    "git push --force-with-lease origin 24-joins:25-other",
    "git push --force-with-lease origin 24-joins:24-joins && git push -f origin main",
    "git -C ../other push --force origin main:main",
    "git  push -f origin main",
    "git push '-f' origin main",
    "git push -fu origin main",
    "git -c x=y push -f origin main",
    "git push origin +HEAD:main",
    "git push origin :main",
    "git push --mirror origin",
    "git push --delete origin main",
    "git branch --delete --force x",
    "git branch -fD x",
    "git branch -df x",
    "git reset  --hard",
    "git reset\t--hard",
    "git push --force-with-lease origin 24-joins:24-joins 2>x&git\treset\t--hard",
    "git -C `x` push --force-with-lease origin 24-joins:24-joins",
    "git commit -q -F - <<'EOF'\nx\nEOF\ngit add -A",
  ])("blocks %j", (command) => {
    expect(statusFor(command)).toBe(2);
  });

  test.each([
    "git add scripts/a.mjs .claude/hooks/x.sh",
    "git commit -q -F -",
    "git commit --amend",
    "git commit -m 'add -a flag'",
    "git push -u origin 302-retro:302-retro",
    "git push --force-with-lease origin 24-joins:24-joins",
    "git push --force-with-lease=24-joins:origin/24-joins origin 24-joins:24-joins 2>&1 | tail -1",
    "git -C .claude/worktrees/24-joins push --force-with-lease origin 24-joins:24-joins",
    "git checkout -b 302-retro",
    "git branch -d old",
    "git restore --staged f.ts",
  ])("lets %j run", (command) => {
    expect(statusFor(command)).toBe(0);
  });

  test("reads past a heredoc's body, which may name a blocked command", () => {
    const commit =
      "git add a.ts && git commit -q -F - <<'EOF'\nmentions git add -A\nEOF\ngit log -1";

    expect(statusFor(commit)).toBe(0);
    expect(statusFor("cat <<EOF > notes\ngit reset --hard\nEOF")).toBe(0);
  });
});
