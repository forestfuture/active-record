import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";

const github = new URL("../../.github/", import.meta.url).pathname;

/** The workflows (`.github/workflows/`) and composite actions (`.github/actions/`). */
function workflowAndActionFiles(): string[] {
  return readdirSync(github, { recursive: true, encoding: "utf8" })
    .filter((path) => /^(?:workflows|actions)\/.*\.ya?ml$/.test(path))
    .map((path) => join(github, path));
}

const workflows = () =>
  workflowAndActionFiles().filter((file) => file.startsWith(join(github, "workflows")));

/** `uses:` references to other repositories' actions (a local `./` action is ours). */
function thirdPartyActions(file: string): string[] {
  return [...readFileSync(file, "utf8").matchAll(/^\s*(?:-\s*)?uses:\s*(\S+)/gm)]
    .map(([, reference]) => reference!)
    .filter((reference) => !reference.startsWith("./"));
}

// A tag can be moved to other code; a commit SHA can't (#80). Dependabot keeps the pins current.
describe("CI's third-party actions", () => {
  test("are pinned to a full commit SHA", () => {
    const unpinned = workflowAndActionFiles().flatMap((file) =>
      thirdPartyActions(file)
        .filter((reference) => !/@[0-9a-f]{40}$/.test(reference))
        .map((reference) => `${file.slice(github.length)}: ${reference}`),
    );

    expect(unpinned).toEqual([]);
  });

  test("are found, so the pin check isn't passing on nothing", () => {
    expect(workflowAndActionFiles().flatMap(thirdPartyActions).length).toBeGreaterThan(0);
  });
});

/** A workflow's own settings (before `jobs:`), and each job as its name and text. */
function partsOf(file: string): { settings: string; jobs: [string, string][] } {
  const text = readFileSync(file, "utf8");
  const start = text.indexOf("\njobs:\n");
  const jobs = text
    .slice(start)
    .split(/^(?=  [\w-]+:\s*$)/m)
    .slice(1)
    .map((job): [string, string] => [job.trim().split(":")[0]!, job]);
  return { settings: text.slice(0, start), jobs };
}

/** Any write permission: one scope (`contents: write`), or all of them (`write-all`). */
const writes = /^\s*(?:permissions:\s*write-all|[\w-]+:\s*write)\b/m;

describe("CI's permissions", () => {
  test("are read-only for a whole workflow; a job that needs to write says so itself", () => {
    const widened = workflows().filter((file) => {
      const { settings } = partsOf(file);
      return !/^permissions:\n {2}contents: read$(?!\n )/m.test(settings) || writes.test(settings);
    });

    expect(widened.map((file) => file.slice(github.length))).toEqual([]);
  });
});

// A release job decides, builds, versions or publishes what users install, so it runs no dependency's
// install scripts and doesn't restore the shared cache (#80), with or without a write token.
describe("CI's release jobs, and every job that can write", () => {
  const jobs = () => workflows().flatMap((file) => partsOf(file).jobs);

  test("are the release jobs, and Scorecard's", () => {
    const writing = jobs().filter(([, job]) => writes.test(job));

    expect(writing.length).toBeGreaterThan(0);
    expect(writing.every(([name]) => name.startsWith("release-") || name === "scorecard")).toBe(
      true,
    );
  });

  // Scorecard publishes its result with `id-token: write` (#111), so its job runs nothing of ours:
  // only pinned third-party actions, with no `run:` step and no local action.
  test("Scorecard's job runs only third-party actions", () => {
    const scorecard = jobs().filter(([name]) => name === "scorecard");

    expect(scorecard).toHaveLength(1);
    const [, job] = scorecard[0]!;
    expect(job).not.toMatch(/^\s*(?:-\s*)?run:/m);
    expect(job).not.toMatch(/uses:\s*\.\//);
  });

  test("install dependencies without their install scripts or the shared cache", () => {
    const release = jobs().filter(
      ([name, job]) => name.startsWith("release-") && /setup-vp/.test(job),
    );

    expect(release.map(([name]) => name)).toEqual([
      "release-mode",
      "release-version",
      "release-pack",
      "release-publish",
    ]);
    for (const [name, job] of release) {
      expect(job, name).toMatch(
        /uses: \.\/\.github\/actions\/setup-vp\n\s+with:\n\s+release: true/,
      );
    }
  });
});

describe("CI's tests (#365)", () => {
  const ci = () => new Map(partsOf(join(github, "workflows/ci.yml")).jobs);

  test("run in 4 shards, each with Postgres, saving its results without the coverage floor", () => {
    const job = ci().get("test") ?? "";

    expect(job).toMatch(/shard: \[1, 2, 3, 4\]/);
    expect(job).toMatch(/services:\n\s+postgres:/);
    expect(job).toContain(
      "--shard=${{ matrix.shard }}/4 --coverage --coverage.thresholds.branches=0 --reporter=blob",
    );
  });

  test("are merged by check, the required job, which holds the coverage floor", () => {
    const job = ci().get("check") ?? "";

    expect(job).toMatch(/needs: \[static, test\]/);
    // A skipped required check counts as passing, so check runs and fails when a job it needs did.
    expect(job).toContain("if: ${{ !cancelled() }}");
    expect(job).toContain("needs.static.result");
    expect(job).toContain("needs.test.result");
    expect(job).toContain("vp test --merge-reports");
    expect(job).toContain("--coverage");
  });

  test("leave the static checks to a job of their own, beside them", () => {
    const job = ci().get("static") ?? "";

    expect(job).toContain("vp check");
    expect(job).toContain("vp run docs:build");
    expect(job).not.toContain("needs:");
  });
});
