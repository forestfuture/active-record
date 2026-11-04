// Loading a project's TypeScript as its own code loads it, with jiti: its Model files and its own
// copy of the library. Shared by the console and the schema command (#104, #232).
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import { createJiti } from "jiti";
import { shown, slashed } from "./paths.ts";
import { oneModelsFile } from "./targets.ts";

/**
 * A jiti based in the project: it reads TypeScript, extensionless imports and `tsconfig.json`
 * paths, and resolves the library (`@forestfuture/active-record` and `@forestfuture/d1-record`)
 * from the project's `node_modules`, so the Models and the command share a single copy of it.
 */
export function projectJiti(cwd: string): Jiti {
  return createJiti(`${cwd}/`, { tsconfigPaths: true, fsCache: false, moduleCache: true });
}

/** The Model files: the folder's `.ts` files, or the one file `--models` names. */
export function modelFiles(cwd: string, models: string): string[] | string {
  const path = resolve(cwd, models);
  if (!existsSync(path)) {
    return `No Models at ${shown(cwd, path)} (run d1-record g model, or pass --models)`;
  }
  if (oneModelsFile(models) || statSync(path).isFile()) return [path];
  return readdirSync(path)
    .filter((name) => name.endsWith(".ts") && !name.endsWith(".d.ts"))
    .sort()
    .map((name) => join(path, name));
}

export type Jiti = ReturnType<typeof createJiti>;

/** The library, as the project installs it: the core, and the D1 adapter beside it. */
const libraryNames = ["@forestfuture/active-record", "@forestfuture/d1-record"];

/** Whether `error` is the loader failing to find `name` itself, not something it imports. */
function isMissing(error: unknown, name: string): boolean {
  const { code, message } = error as { code?: unknown; message?: unknown };
  return (
    (code === "MODULE_NOT_FOUND" || code === "ERR_MODULE_NOT_FOUND") &&
    String(message).startsWith(`Cannot find module '${name}'`)
  );
}

/**
 * The project's own library (the core and the D1 adapter, as one module), or why it can't be
 * loaded. It is imported from a file in the project, as its Models import it, because only imports
 * made inside a file follow a `tsconfig.json` path (a workspace link), and so the Models and the
 * console get one copy.
 */
export async function loadLibrary<L>(
  cwd: string,
  jiti: Jiti,
  command: string,
): Promise<L | string> {
  try {
    const source = libraryNames.map((name) => `export * from "${name}";`).join("\n");
    const filename = join(cwd, `d1-record-${command}.ts`);
    return (await jiti.evalModule(source, { filename, async: true })) as L;
  } catch (error) {
    const missing = libraryNames.find((name) => isMissing(error, name));
    if (missing !== undefined) {
      return `${missing} isn't installed here (install it, then run d1-record ${command} again)`;
    }
    return `Couldn't load the library: ${(error as Error).message}`;
  }
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
