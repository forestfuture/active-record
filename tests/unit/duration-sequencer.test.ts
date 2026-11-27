import fc from "fast-check";
import { describe, expect, test } from "vite-plus/test";
import type { TestSpecification } from "vite-plus/test/node";
import { balanceShards, DurationSequencer } from "../support/duration-sequencer.ts";
import { PURE_RUNS } from "../support/properties.ts";

const keysOf = (shards: { key: string }[][]) => shards.map((shard) => shard.map(({ key }) => key));

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
});

describe("DurationSequencer (#614)", () => {
  /** A test file as Vitest gives the sequencer one: its project's name and its absolute path. */
  const spec = (project: string, path: string) =>
    ({ project: { name: project }, moduleId: `/repo/${path}` }) as unknown as TestSpecification;
  const sequencer = (index: number, count: number, durations: Record<string, number>) =>
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
});
