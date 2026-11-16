import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll } from "vite-plus/test";
import { scratchFolder, shareCompileCache } from "./compile-cache.ts";

/**
 * Throwaway folders for a test file, removed when it finishes. Call once at the top of the file.
 * One in the repo finds this repo's node_modules, as an app finds its own.
 * `outsideTheRepo` makes one in the system's temp folder, out of reach of this repo's node_modules
 * and tsconfig. Each shares the test projects' compiled-TypeScript cache (#416), which only
 * adds `node_modules/.cache/jiti`, unless `sharedCompileCache` is false, for the tests of the
 * cache itself.
 */
export function scratchDirs({ sharedCompileCache = true } = {}) {
  const made: string[] = [];
  afterAll(() => {
    for (const dir of made) rmSync(dir, { recursive: true, force: true });
  });
  return (prefix: string, outsideTheRepo = false): string => {
    if (!outsideTheRepo) mkdirSync(scratchFolder, { recursive: true });
    const dir = mkdtempSync(join(outsideTheRepo ? tmpdir() : scratchFolder, prefix));
    made.push(dir);
    if (sharedCompileCache) shareCompileCache(dir);
    return dir;
  };
}
