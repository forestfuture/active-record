import { readdirSync, utimesSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { pruneCompileCache } from "../support/compile-cache.ts";
import { scratchDirs } from "../support/scratch.ts";

const scratch = scratchDirs({ sharedCompileCache: false });

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

  test("removes the fill's own entry, whenever it was written", () => {
    const cache = scratch("compile-cache-prune-fill-");
    writeFileSync(join(cache, "src-index.1.mjs"), "library");
    writeFileSync(join(cache, "compile-cache-fill-a1b2c3-active-record-test.2.mjs"), "fill");

    pruneCompileCache(cache, Date.now() + 60_000);

    expect(readdirSync(cache)).toEqual(["src-index.1.mjs"]);
  });
});
