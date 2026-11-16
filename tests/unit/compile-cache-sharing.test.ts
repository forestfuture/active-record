import { existsSync, lstatSync, mkdirSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { sharedCacheFolder } from "../support/compile-cache.ts";
import { scratchDirs } from "../support/scratch.ts";

const scratch = scratchDirs();
const bare = scratchDirs({ sharedCompileCache: false });

// The command's compiled TypeScript is cached in a project's node_modules/.cache/jiti, so the
// test projects share one, and only the first load of a run compiles the library (#416).
describe("a scratch project", () => {
  test("caches compiled TypeScript in the shared folder", () => {
    const dir = scratch("sharing-");

    expect(realpathSync(join(dir, "node_modules/.cache/jiti"))).toBe(
      realpathSync(sharedCacheFolder),
    );
  });

  test("made outside the repo caches compiled TypeScript in the shared folder", () => {
    const dir = scratch("sharing-outside-", true);

    expect(realpathSync(join(dir, "node_modules/.cache/jiti"))).toBe(
      realpathSync(sharedCacheFolder),
    );
  });

  test("keeps its node_modules to itself, for the stand-in packages a test writes there", () => {
    const dir = scratch("sharing-");
    mkdirSync(join(dir, "node_modules/wrangler"), { recursive: true });

    expect(lstatSync(join(dir, "node_modules")).isSymbolicLink()).toBe(false);
    expect(lstatSync(join(dir, "node_modules/.cache")).isSymbolicLink()).toBe(false);
  });

  test("is bare, with no node_modules, when its file opts out", () => {
    const dir = bare("sharing-bare-");

    expect(existsSync(join(dir, "node_modules"))).toBe(false);
  });
});
