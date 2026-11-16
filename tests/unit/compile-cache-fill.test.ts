import { readdirSync } from "node:fs";
import { describe, expect, test } from "vite-plus/test";
import { fillCompileCache } from "../support/compile-cache.ts";
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
