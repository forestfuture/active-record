// The checks CI runs, in CI's order, with one line per step: the failing step's output follows it.
// Run with `vp run validate` before asking to push (docs/agents/workflow.md, step 5).
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";

const wrangler = fileURLToPath(
  new URL("../.github/docs-deploy/node_modules/.bin/wrangler", import.meta.url),
);

const steps = [
  { name: "check", args: ["check"] },
  { name: "test and coverage", args: ["run", "coverage"] },
  { name: "build", args: ["run", "build"] },
  { name: "public types", args: ["run", "check:public-types"] },
  { name: "knip", args: ["run", "knip"] },
  { name: "docs build", args: ["run", "docs:build"] },
  { name: "package contents", args: ["run", "check:package"] },
  // docs-deploy's own Wrangler, as check runs it (#253).
  {
    name: "docs deploy install",
    command: "pnpm",
    args: ["install", "--frozen-lockfile", "--ignore-scripts"],
    cwd: ".github/docs-deploy",
  },
  { name: "guide deploy dry run", command: wrangler, args: ["deploy", "--dry-run"], cwd: "site" },
  {
    name: "library list deploy dry run",
    command: wrangler,
    args: ["deploy", "--dry-run", "--config", "host/wrangler.jsonc"],
    cwd: "site",
  },
];

for (const { name, command = "vp", args, cwd } of steps) {
  const started = Date.now();
  const run = spawnSync(command, args, { cwd, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  const seconds = ((Date.now() - started) / 1000).toFixed(1);
  if (run.status === 0) {
    console.log(`pass  ${name} (${seconds}s)`);
    continue;
  }
  console.log(`FAIL  ${name} (${seconds}s), \`${[command, ...args].join(" ")}\`:`);
  const output = `${run.stdout}${run.stderr}`.trimEnd().split("\n");
  console.log(output.slice(-80).join("\n"));
  process.exit(run.status ?? 1);
}
console.log("All steps passed.");
