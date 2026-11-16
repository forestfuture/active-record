import { readdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { fillCompileCache, pruneCompileCache } from "../support/compile-cache.ts";
import { scratchDirs } from "../support/scratch.ts";

// A file of its own, so the library isn't already loaded in this worker, which would leave the
// cache unfilled however it's asked.
const scratch = scratchDirs({ sharedCompileCache: false });

// The run's globalSetup fills the shared cache before any test's time limit starts (#416).
describe("filling the compile cache", () => {
  test("compiles the core's and both adapters' entries into it", async () => {
    const cache = scratch("compile-cache-fill-");

    await fillCompileCache(cache);

    const entries = readdirSync(cache);
    expect(entries.some((name) => name.startsWith("src-index."))).toBe(true);
    expect(entries.some((name) => name.startsWith("d1-index."))).toBe(true);
    expect(entries.some((name) => name.startsWith("postgresql-index."))).toBe(true);
  });
});

// The test projects' own files land in the shared cache under their folders' random names, so
// the run's teardown removes what it added, and the cache keeps only the library (#416).
describe("pruning the compile cache", () => {
  test("removes the entries written since a time, and keeps older ones", () => {
    const cache = scratch("compile-cache-prune-");
    const old = join(cache, "src-index.1.mjs");
    writeFileSync(old, "library");
    const before = new Date(Date.now() - 60_000);
    utimesSync(old, before, before);
    const since = Date.now() - 30_000;
    writeFileSync(join(cache, "models-user.2.mjs"), "a project's Model");

    pruneCompileCache(cache, since);

    expect(readdirSync(cache)).toEqual(["src-index.1.mjs"]);
  });
});
