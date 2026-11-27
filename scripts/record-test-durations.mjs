// Records how long each test file took in a CI run, in tests/support/test-durations.json, so
// DurationSequencer can balance CI's test shards (#614). Run `vp run test:durations <run-id>` with
// a recent run on main whose tests passed: its blob reports are kept for a day.
import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, readdirSync, renameSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const run = process.argv[2];
if (!/^\d+$/.test(run ?? "")) {
  console.error(
    "Usage: vp run test:durations <run-id>, a CI run from gh run list --workflow ci.yml",
  );
  process.exit(1);
}

// Only a passing run of a push to main: a pull request's run, from a fork among others, uploads
// reports its author controls, and a failed run's are missing what didn't finish.
const { event, headBranch, conclusion, workflowName } = JSON.parse(
  execFileSync("gh", ["run", "view", run, "--json", "event,headBranch,conclusion,workflowName"], {
    encoding: "utf8",
  }),
);
if (
  workflowName !== "CI" ||
  event !== "push" ||
  headBranch !== "main" ||
  conclusion !== "success"
) {
  console.error(
    `Run ${run} is ${workflowName}'s ${event} run on ${headBranch} (${conclusion}): record a passing CI run of a push to main`,
  );
  process.exit(1);
}

const dir = mkdtempSync(join(tmpdir(), "test-durations-"));
try {
  execFileSync("gh", ["run", "download", run, "--pattern", "blob-*", "--dir", dir], {
    stdio: "inherit",
  });
  // gh saves each shard's report in a folder of its own, and the merge reads one folder.
  const merged = join(dir, "merged");
  mkdirSync(merged);
  for (const shard of readdirSync(dir).filter((name) => name.startsWith("blob-"))) {
    for (const file of readdirSync(join(dir, shard))) {
      renameSync(join(dir, shard, file), join(merged, file));
    }
  }
  // DATABASE_URL names the Postgres projects in the config, as on CI, so their results merge.
  // Merging runs no tests, so nothing connects to it.
  execFileSync(
    "vp",
    ["test", `--merge-reports=${merged}`, "--reporter=./tests/support/durations-reporter.ts"],
    {
      stdio: "inherit",
      env: {
        ...process.env,
        DATABASE_URL: process.env.DATABASE_URL ?? "postgres://localhost/unused",
      },
    },
  );
} finally {
  rmSync(dir, { recursive: true, force: true });
}
