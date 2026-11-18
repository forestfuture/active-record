// Removes an issue branch and its worktree once its pull request is merged:
// `node scripts/remove-merged-branch.mjs <issue>-<slug>`, from the main checkout. It refuses unless
// a merged pull request's head is the branch's tip, so no local commit is lost, and git refuses a
// worktree with uncommitted changes. Ignored files in the worktree, such as node_modules or a .env,
// go with it (docs/agents/workflow.md, step 5).
import { execFileSync } from "node:child_process";

/** Prints why the branch stays, and exits. */
function refuse(message) {
  process.stderr.write(`${message}\n`);
  process.exit(1);
}

/** Runs a command, returning its trimmed output, or refuses with its error. */
function run(command, args) {
  try {
    return execFileSync(command, args, { encoding: "utf8", stdio: "pipe" }).trim();
  } catch (error) {
    return refuse(String(error.stderr || error.message).trim());
  }
}

/** The worktree path that has branch checked out, if any. */
function worktreeOf(branch) {
  const blocks = run("git", ["worktree", "list", "--porcelain"]).split("\n\n");
  const block = blocks.find((lines) => lines.split("\n").includes(`branch refs/heads/${branch}`));
  return block?.split("\n")[0].replace(/^worktree /, "");
}

const branch = process.argv[2] ?? "";
if (!/^\d+-[a-z0-9-]+$/.test(branch))
  refuse(`Give an issue branch, <issue>-<slug>, not "${branch}".`);

const tip = run("git", ["rev-parse", "--verify", `refs/heads/${branch}`]);
const merged = JSON.parse(
  run("gh", ["pr", "list", "--head", branch, "--state", "merged", "--json", "number,headRefOid"]),
);
if (merged.length === 0) refuse(`${branch} has no merged pull request; it stays.`);
const pull = merged.find((pr) => pr.headRefOid === tip);
if (!pull) refuse(`${branch}'s tip ${tip} isn't the head of a merged pull request; it stays.`);

const worktree = worktreeOf(branch);
if (worktree) run("git", ["worktree", "remove", worktree]);
run("git", ["branch", "-D", branch]);
process.stdout.write(
  `Removed ${branch}${worktree ? ` and ${worktree}` : ""} (pull request #${pull.number}).\n`,
);
