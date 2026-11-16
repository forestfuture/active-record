// One compiled-TypeScript cache for the test projects, so only a run's first load compiles the library (#416).
import { mkdirSync, readdirSync, rmSync, statSync, symlinkSync } from "node:fs";
import { join } from "node:path";
import {
  corePackage,
  loadLibrary,
  projectJiti,
} from "../../packages/active-record/cli/project/load.ts";

/**
 * The folder the test projects' compiled TypeScript is cached in. The command keeps it in a
 * project's `node_modules/.cache/jiti` (#251), and jiti checks each entry against its source, so
 * projects can share one, and a run can start from the last one's.
 */
export const sharedCompileCache = new URL("../.scratch/jiti-cache/", import.meta.url).pathname;

/**
 * Points a project's jiti cache at the shared one. Only that folder is linked: the project's
 * `node_modules` stays its own, for the stand-in packages a test writes there, as does
 * `node_modules/.cache`, where the console keeps its files.
 */
export function shareCompileCache(dir: string, cache = sharedCompileCache): void {
  mkdirSync(cache, { recursive: true });
  mkdirSync(join(dir, "node_modules/.cache"), { recursive: true });
  symlinkSync(cache, join(dir, "node_modules/.cache/jiti"), "dir");
}

/** The library's entries a command loads: the core, and each adapter's. */
const entries = [corePackage, `${corePackage}/d1`, `${corePackage}/postgresql`];

/**
 * Compiles the library into `cache`, as a command loads it from a project in the repo. A process
 * that has loaded it already doesn't compile it again, so this fills the cache only before then.
 */
export async function fillCompileCache(cache = sharedCompileCache): Promise<void> {
  // One folder every run, so the wrapper jiti caches for it is one entry, not one per run.
  const project = new URL("../.scratch/compile-cache-fill/", import.meta.url).pathname;
  rmSync(project, { recursive: true, force: true });
  mkdirSync(project, { recursive: true });
  try {
    shareCompileCache(project, cache);
    const loaded = await loadLibrary(project, projectJiti(project), {
      command: "test",
      packages: entries,
    });
    if (typeof loaded === "string") throw new Error(loaded);
  } finally {
    rmSync(project, { recursive: true, force: true });
  }
}

/**
 * Removes the entries written to `cache` after `since`. The library is compiled before then, by
 * `setup`, and each of its entries is named by its file's path, so an edited file replaces its
 * own. What's written later is the test projects' own files, named by their folders' random
 * paths, which no other run reads.
 */
export function pruneCompileCache(cache: string, since: number): void {
  for (const name of readdirSync(cache)) {
    const entry = join(cache, name);
    if (statSync(entry).mtimeMs > since) rmSync(entry, { force: true });
  }
}

/**
 * Vitest's globalSetup: the run's first compile happens here, before any test's time limit, and
 * its teardown leaves the cache holding only the library.
 */
export async function setup(): Promise<() => void> {
  await fillCompileCache();
  const filled = Date.now();
  return () => pruneCompileCache(sharedCompileCache, filled);
}
