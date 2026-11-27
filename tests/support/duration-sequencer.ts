// The test files' recorded durations (test-durations.json: its path, its keys, reading it), and the sequencer that puts CI's test files in shards by them, so the shards take about as long as each other (#614).
import { readFileSync } from "node:fs";
import { join, relative, sep } from "node:path";
import { BaseSequencer, type TestSpecification, type Vitest } from "vite-plus/test/node";

/** A test file in one project, and the seconds a recorded run took for it, if one did. */
export interface TimedFile {
  readonly key: string;
  readonly seconds: number | undefined;
}

/** The key a file's duration is recorded under: its project's name, then its path from that project's root. */
export const durationKey = (project: string, path: string) => `${project} ${path}`;

/** The seconds each test file took in a recorded run, by `durationKey`. */
export type Durations = Readonly<Record<string, number>>;

/** Where the recorded durations live, from the repo's root. */
export const durationsPath = "tests/support/test-durations.json";

/**
 * `files` split into `count` shards of about equal recorded time: the longest first, each into the
 * shard with the least time so far (the first such shard on a tie). A file with no record counts
 * as the median of the recorded ones. The split depends on the files and their records, not on
 * their order, so each shard can compute it for itself.
 */
export function balanceShards<File extends TimedFile>(
  files: readonly File[],
  count: number,
): File[][] {
  const unrecordedSeconds = median(
    files.flatMap(({ seconds }) => (seconds === undefined ? [] : [seconds])),
  );
  const longestFirst = files
    .map((file) => ({ file, seconds: file.seconds ?? unrecordedSeconds }))
    .sort((a, b) => b.seconds - a.seconds || byCodePoint(a.file.key, b.file.key));
  const shards = Array.from({ length: count }, () => ({ files: [] as File[], seconds: 0 }));
  for (const { file, seconds } of longestFirst) {
    const lightest = shards.reduce((least, shard) =>
      shard.seconds < least.seconds ? shard : least,
    );
    lightest.files.push(file);
    lightest.seconds += seconds;
  }
  return shards.map((shard) => shard.files);
}

/** Orders keys as `<` compares them, the same on every platform. */
export const byCodePoint = (a: string, b: string) => (a < b ? -1 : a > b ? 1 : 0);

/** The middle of `values` once sorted, or 1 when there are none. */
function median(values: number[]): number {
  if (values.length === 0) return 1;
  const sorted = values.toSorted((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 1 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

/**
 * Vitest's own sequencer, but `--shard` splits the files by their recorded durations
 * (`balanceShards`) instead of by a hash of each path. Without `--shard` it changes nothing.
 */
export class DurationSequencer extends BaseSequencer {
  readonly #durations: Durations | undefined;

  /** `durations` replaces the recorded ones, for tests. */
  constructor(ctx: Vitest, durations?: Durations) {
    super(ctx);
    this.#durations = durations;
  }

  override async shard(files: TestSpecification[]): Promise<TestSpecification[]> {
    const { root, shard } = this.ctx.config;
    const durations = this.#durations ?? readDurations(root);
    const timed = files.map((spec) => {
      const key = keyOf(spec);
      return { key, seconds: durations[key], spec };
    });
    return balanceShards(timed, shard!.count)[shard!.index - 1]!.map(({ spec }) => spec);
  }
}

/**
 * A file's key, from its path as Vitest's reports name it: from its project's root, with `/`
 * between folders on every platform.
 */
function keyOf(spec: TestSpecification): string {
  const path = relative(spec.project.config.root, spec.moduleId).split(sep).join("/");
  return durationKey(spec.project.name, path);
}

function readDurations(root: string): Durations {
  return JSON.parse(readFileSync(join(root, durationsPath), "utf8")) as Durations;
}
