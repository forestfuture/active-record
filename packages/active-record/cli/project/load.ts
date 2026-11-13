// Loading a project's TypeScript as its own code loads it, with jiti: its Model files and its own
// copy of the library. Shared by the console and the schema command (#104, #232).
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { createJiti } from "jiti";
import { shown, slashed } from "./paths.ts";
import { oneModelsFile } from "./targets.ts";

/**
 * A jiti based in the project: it reads TypeScript, extensionless imports and `tsconfig.json`
 * paths, and resolves the library (`@forestfuture/active-record` and its adapter's package)
 * from the project's `node_modules`, so the Models and the command share a single copy of it.
 * What it compiles is cached by content in the project's `node_modules/.cache/jiti`, so a run
 * after the first loads the library about ten times faster, and an edited file is compiled again
 * (#251). Without `node_modules` it isn't cached: jiti would use the system's temporary folder,
 * which on a shared machine another user could write compiled code into for this one to run.
 */
export function projectJiti(cwd: string): Jiti {
  const modules = join(cwd, "node_modules");
  const fsCache = existsSync(modules) ? join(modules, ".cache/jiti") : false;
  return createJiti(`${cwd}/`, { tsconfigPaths: true, fsCache, moduleCache: true });
}

/** The Model files: the folder's `.ts` files, or the one file `--models` names. */
export function modelFiles(cwd: string, models: string): string[] | string {
  const path = resolve(cwd, models);
  if (!existsSync(path)) {
    return `No Models at ${shown(cwd, path)} (run active-record g model, or pass --models)`;
  }
  if (oneModelsFile(models) || statSync(path).isFile()) return [path];
  return readdirSync(path)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".d.ts"))
    .sort()
    .map((name) => join(path, name));
}

export type Jiti = ReturnType<typeof createJiti>;

/** The core, which every command loads from the project, beside the adapter some need. */
export const corePackage = "@forestfuture/active-record";

/** Whether `error` is the loader failing to find `name` itself, not something it imports. */
function isMissing(error: unknown, name: string): boolean {
  const { code, message } = error as { code?: unknown; message?: unknown };
  return (
    (code === "MODULE_NOT_FOUND" || code === "ERR_MODULE_NOT_FOUND") &&
    String(message).startsWith(`Cannot find module '${name}'`)
  );
}

/**
 * The project's own copies of `packages` (the core, and the adapter when a command needs it), as
 * one module, or why one can't be loaded, naming it. Each is imported from a file in the project,
 * as its Models import it, because only imports made inside a file follow a `tsconfig.json` path
 * (a workspace link), and so the Models and the command get one copy.
 */
export async function loadLibrary<L>(
  cwd: string,
  jiti: Jiti,
  { command, packages }: { command: string; packages: readonly string[] },
): Promise<L | string> {
  const filename = join(cwd, `active-record-${command}.ts`);
  let library = {};
  for (const name of packages) {
    try {
      const source = `export * from "${name}";`;
      const loaded = (await jiti.evalModule(source, { filename, async: true })) as object;
      library = { ...library, ...loaded };
    } catch (error) {
      if (isMissing(error, name)) {
        return `${name} isn't installed here (install it, then run active-record ${command} again)`;
      }
      return `Couldn't load ${name}: ${(error as Error).message}`;
    }
  }
  return library as L;
}

/**
 * Forgets the project's own modules, so they are read again. Its dependencies stay as they are,
 * and so do `keep` (the library's files, which may sit under the project's folder).
 */
export function forgetProjectFiles(cwd: string, jiti: Jiti, keep: ReadonlySet<string>): void {
  const folder = `${slashed(resolve(cwd))}/`;
  for (const file of Object.keys(jiti.cache)) {
    const name = slashed(file);
    if (name.startsWith(folder) && !name.includes("/node_modules/") && !keep.has(file)) {
      delete jiti.cache[file];
    }
  }
}
