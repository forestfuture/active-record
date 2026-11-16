// One compiled-TypeScript cache for the test projects, so only a run's first load compiles the library (#416).
import { mkdirSync, symlinkSync } from "node:fs";
import { join } from "node:path";

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
export function shareCompileCache(dir: string): void {
  mkdirSync(sharedCompileCache, { recursive: true });
  mkdirSync(join(dir, "node_modules/.cache"), { recursive: true });
  symlinkSync(sharedCompileCache, join(dir, "node_modules/.cache/jiti"), "dir");
}
