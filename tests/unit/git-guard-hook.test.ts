import { spawnSync } from "node:child_process";
import { describe, expect, test } from "vite-plus/test";

// The PreToolUse hook that stops an agent staging everything or throwing work away (#302 retro).
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
