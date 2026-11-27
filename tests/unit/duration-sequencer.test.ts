import fc from "fast-check";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test, vi } from "vite-plus/test";
import type { TestModule, TestSpecification } from "vite-plus/test/node";
import {
  balanceShards,
  DurationSequencer,
  type Durations,
  durationsPath,
  median,
} from "../support/duration-sequencer.ts";
import DurationsReporter from "../support/durations-reporter.ts";
import { PURE_RUNS } from "../support/properties.ts";
import { scratchDirs } from "../support/scratch.ts";

const scratch = scratchDirs();

const keysOf = (shards: { key: string }[][]) => shards.map((shard) => shard.map(({ key }) => key));

/** A test file as Vitest gives the sequencer one: its project, and its absolute path. */
const spec = (project: string, path: string, root = "/repo") =>
  ({
    project: { name: project, config: { root } },
    moduleId: `${root}/${path}`,
  }) as unknown as TestSpecification;

describe("balanceShards (#614)", () => {
  test("puts the longest files first, each in the shard with the least time so far", () => {
    const files = [
      { key: "c", seconds: 5 },
      { key: "a", seconds: 10 },
      { key: "e", seconds: 3 },
      { key: "b", seconds: 8 },
      { key: "d", seconds: 4 },
    ];

    expect(keysOf(balanceShards(files, 2))).toEqual([
      ["a", "d"],
      ["b", "c", "e"],
    ]);
  });

  test("counts a file with no record as the median of the recorded ones", () => {
    const recorded = [
      { key: "x", seconds: 10 },
      { key: "y", seconds: 2 },
      { key: "w", seconds: 4 },
    ];

    expect(keysOf(balanceShards([...recorded, { key: "z", seconds: undefined }], 2))).toEqual(
      keysOf(balanceShards([...recorded, { key: "z", seconds: 4 }], 2)),
    );
  });

  const files = fc.uniqueArray(
    fc.record({
      key: fc.string({ minLength: 1 }),
      seconds: fc.option(fc.double({ min: 0, max: 600, noNaN: true }), { nil: undefined }),
    }),
    { selector: (file) => file.key, maxLength: 40 },
  );
  const counts = fc.integer({ min: 1, max: 8 });

  test("puts every file in exactly one shard", () => {
    fc.assert(
      fc.property(files, counts, (given, count) => {
        const shards = balanceShards(given, count);

        expect(shards).toHaveLength(count);
        expect(keysOf(shards).flat().sort()).toEqual(given.map(({ key }) => key).sort());
      }),
      PURE_RUNS,
    );
  });

  // Each shard computes the split for itself, so the order Vitest lists the files in can't change it.
  test("splits the same files the same way, in any order", () => {
    const shuffled = files.chain((given) =>
      fc.tuple(fc.constant(given), fc.shuffledSubarray(given, { minLength: given.length })),
    );
    fc.assert(
      fc.property(shuffled, counts, ([given, reordered], count) => {
        expect(keysOf(balanceShards(reordered, count))).toEqual(
          keysOf(balanceShards(given, count)),
        );
      }),
      PURE_RUNS,
    );
  });

  // Longest first, into the least-loaded shard: a shard passes the even share only by the file
  // that took it there, which is no longer than the longest.
  test("keeps each shard within its even share plus the longest file", () => {
    const recorded = fc.array(fc.double({ min: 0, max: 600, noNaN: true }), { maxLength: 40 });
    fc.assert(
      fc.property(recorded, counts, (seconds, count) => {
        const given = seconds.map((time, index) => ({ key: String(index), seconds: time }));
        const total = seconds.reduce((sum, time) => sum + time, 0);
        const longest = Math.max(0, ...seconds);
        const sums = balanceShards(given, count).map((shard) =>
          shard.reduce((sum, file) => sum + file.seconds, 0),
        );

        for (const sum of sums) expect(sum).toBeLessThanOrEqual(total / count + longest + 1e-6);
      }),
      PURE_RUNS,
    );
  });
});

describe("median (#614)", () => {
  test("is the middle value of an odd number, and the mean of the middle two of an even one", () => {
    expect(median([10, 2, 4])).toBe(4);
    expect(median([10, 2, 4, 6])).toBe(5);
  });

  test("is 1 with nothing recorded, so the files split by count", () => {
    expect(median([])).toBe(1);
  });
});

describe("DurationSequencer (#614)", () => {
  const sequencer = (index: number, count: number, durations: Durations) =>
    new DurationSequencer(
      { config: { root: "/repo", shard: { index, count } } } as never,
      durations,
    );

  test("gives each shard its part of the split, by each file's project and path", async () => {
    const durations = {
      "unit tests/unit/a.test.ts": 1,
      "conformance:d1 tests/conformance/joins.test.ts": 9,
      "conformance:pg tests/conformance/joins.test.ts": 6,
    };
    const unit = spec("unit", "tests/unit/a.test.ts");
    const onD1 = spec("conformance:d1", "tests/conformance/joins.test.ts");
    const onPg = spec("conformance:pg", "tests/conformance/joins.test.ts");

    expect(await sequencer(1, 2, durations).shard([unit, onD1, onPg])).toEqual([onD1]);
    expect(await sequencer(2, 2, durations).shard([unit, onD1, onPg])).toEqual([onPg, unit]);
  });

  // As Vitest names a file in its reports: by its path from its own project's root.
  test("finds a file's record by its path from its project's root", async () => {
    const durations = {
      "site tests/a.test.ts": 9,
      "unit tests/b.test.ts": 5,
      "unit tests/c.test.ts": 1,
    };
    const inSite = spec("site", "tests/a.test.ts", "/repo/site");
    const b = spec("unit", "tests/b.test.ts");
    const c = spec("unit", "tests/c.test.ts");

    expect(await sequencer(1, 2, durations).shard([inSite, b, c])).toEqual([inSite]);
  });

  // The split only ever sees the files Vitest lists, so a deleted file's record changes nothing:
  // not even the median an unrecorded file counts as.
  test("ignores a record for a file that no longer exists", async () => {
    const durations = { "unit tests/b.test.ts": 5, "unit tests/c.test.ts": 1 };
    const files = ["b", "c", "unrecorded"].map((name) => spec("unit", `tests/${name}.test.ts`));
    const withGone = { ...durations, "unit tests/gone.test.ts": 100 };

    expect(await sequencer(1, 2, withGone).shard(files)).toEqual(
      await sequencer(1, 2, durations).shard(files),
    );
  });
});

describe("DurationsReporter (#614)", () => {
  /** The milliseconds Vitest's diagnostic gives a file, each 0 unless given. */
  type Times = Partial<ReturnType<TestModule["diagnostic"]>>;
  /** A test file as Vitest reports one: its project, its path from that project's root, its times. */
  const reported = (project: string, path: string, times: Times) =>
    ({
      project: { name: project },
      relativeModuleId: path,
      diagnostic: () => ({
        duration: 0,
        collectDuration: 0,
        setupDuration: 0,
        environmentSetupDuration: 0,
        prepareDuration: 0,
        ...times,
      }),
    }) as unknown as TestModule;

  /** What the reporter writes for `modules`, in a scratch folder standing for the repo. */
  function record(modules: TestModule[]): Durations {
    const root = scratch("durations-", true);
    mkdirSync(join(root, "tests/support"), { recursive: true });
    const reporter = new DurationsReporter();
    reporter.onInit({ config: { root } } as never);
    reporter.onTestRunEnd(modules);
    return JSON.parse(readFileSync(join(root, durationsPath), "utf8")) as Durations;
  }

  // Run on CI's merged reports, its keys must be the ones the sequencer looks each file up by.
  test("records each file under the key the sequencer finds it by", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const durations = record([
      reported("unit", "tests/a.test.ts", { duration: 9000 }),
      reported("unit", "tests/b.test.ts", { duration: 5000 }),
      reported("unit", "tests/c.test.ts", { duration: 1000 }),
    ]);
    const files = ["a", "b", "c"].map((name) => spec("unit", `tests/${name}.test.ts`));
    const sequencer = new DurationSequencer(
      { config: { root: "/repo", shard: { index: 1, count: 2 } } } as never,
      durations,
    );

    expect(await sequencer.shard(files)).toEqual([files[0]]);
  });

  test("records all the time a file takes its worker, to a tenth of a second", () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    const timed = reported("unit", "tests/a.test.ts", {
      duration: 1000,
      collectDuration: 200,
      setupDuration: 300,
      environmentSetupDuration: 400,
      prepareDuration: 520,
    });

    expect(record([timed])).toEqual({ "unit tests/a.test.ts": 2.4 });
  });
});
