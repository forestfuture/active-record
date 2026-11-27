// Pushes the checked-out issue branch to its namesake on origin, with a lease, and tracks it:
// `node scripts/push-branch.mjs`, from the branch's worktree. One command for the first push and for
// each push after a rebase on `main`. The lease refuses when origin's branch moved since this clone
// last fetched it, and --force-if-includes when origin's branch holds a commit the local branch
// never had, though fetched, so a push never drops a commit someone else pushed. It refuses any
// branch but `<issue>-<slug>`, so it never pushes `main` (docs/agents/workflow.md, step 5).
import { spawnSync } from "node:child_process";

const branch = String(
  spawnSync("git", ["branch", "--show-current"], { encoding: "utf8" }).stdout,
).trim();
if (!/^\d+-[a-z0-9-]+$/.test(branch)) {
  process.stderr.write(`Check out an issue branch, <issue>-<slug>, to push it, not "${branch}".\n`);
  process.exit(1);
}

const ref = `refs/heads/${branch}`;
const push = spawnSync(
  "git",
  ["push", "--force-with-lease", "--force-if-includes", "-u", "origin", `${ref}:${ref}`],
  {
    stdio: "inherit",
  },
);
if (push.status !== 0) {
  process.stderr.write(
    "If the push was refused as stale, origin's branch holds a commit this one doesn't: rebase on it first.\n" +
      "If the push failed with `agent refused operation`, the human's SSH key is locked: ask them to push.\n",
  );
}
process.exit(push.status ?? 1);
