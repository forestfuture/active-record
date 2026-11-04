// Loads (and reloads) a project's TypeScript Models and its own copy of the library for the console (#104).
import { resolve, sep } from "node:path";
import {
  forgetProjectFiles,
  loadLibrary,
  modelFiles,
  projectJiti,
  type Jiti,
} from "../project/load.ts";
import { isBase } from "@forestfuture/active-record/cli";
import { shown } from "../project/paths.ts";
import { defaultModels } from "../project/targets.ts";
import type { StatementEvent } from "./verbose.ts";

/**
 * What the console uses of the project's library (the core and the D1 adapter). Typed loosely on
 * purpose: it is the project's copy, loaded at run time, and not the one this command was built
 * against.
 */
interface Library {
  connect: (binding: unknown, options?: { onQuery?: (event: StatementEvent) => void }) => unknown;
  withDatabase: (database: unknown, run: () => unknown) => Promise<unknown>;
  Model: abstract new (...args: never[]) => unknown;
}

export interface ConsoleProject {
  library: Library;
  /** Each Model class the models folder exports, by name. */
  models: Record<string, unknown>;
  /**
   * Reads the project's files again, so edits show: the Models now, or why they can't be loaded
   * (the loaded Models are left as they were). The library is not reloaded: it stays one copy.
   */
  reload: () => Promise<Record<string, unknown> | string>;
}

/** The Model classes the files export, by name; or the file that couldn't be loaded. */
async function loadModels(
  cwd: string,
  jiti: Jiti,
  files: readonly string[],
  library: Library,
): Promise<Record<string, unknown> | string> {
  const found: Record<string, unknown> = {};
  for (const file of files) {
    let exported: Record<string, unknown>;
    try {
      exported = await jiti.import<Record<string, unknown>>(file);
    } catch (error) {
      // Syntax errors name the file by its full path; the project's own folder is implied.
      const message = (error as Error).message.replaceAll(`${resolve(cwd)}${sep}`, "");
      return `Couldn't load ${shown(cwd, file)}: ${message}`;
    }
    for (const [name, value] of Object.entries(exported)) {
      // The classes Models are built on (ApplicationRecord) aren't Models themselves.
      if (
        typeof value === "function" &&
        value.prototype instanceof library.Model &&
        !isBase(value)
      ) {
        found[name] = value;
      }
    }
  }
  return found;
}

/** The Models found in the files now, or why there are none to use. */
async function modelsIn(
  cwd: string,
  models: string,
  jiti: Jiti,
  library: Library,
): Promise<Record<string, unknown> | string> {
  const files = modelFiles(cwd, models);
  if (typeof files === "string") return files;
  const found = await loadModels(cwd, jiti, files, library);
  if (typeof found === "string") return found;
  if (Object.keys(found).length === 0) {
    return `No Models in ${shown(cwd, resolve(cwd, models))} (run d1-record g model, or pass --models)`;
  }
  return found;
}

/**
 * The project's Models and library, loaded as its own code would load them: one `jiti` based in
 * the project reads TypeScript, extensionless imports and `tsconfig.json` paths, and resolves
 * the library from the project's `node_modules`, so the Models and the console
 * share a single copy of the library. Or why they can't be loaded.
 */
export async function loadProject(
  cwd: string,
  models = defaultModels,
): Promise<ConsoleProject | string> {
  // A missing models folder is reported before a missing library, as it always has been.
  const files = modelFiles(cwd, models);
  if (typeof files === "string") return files;
  const jiti = projectJiti(cwd);
  const loadedBefore = new Set(Object.keys(jiti.cache));
  const library = await loadLibrary<Library>(cwd, jiti, "console");
  if (typeof library === "string") return library;
  const libraryFiles = new Set(Object.keys(jiti.cache).filter((file) => !loadedBefore.has(file)));
  const found = await modelsIn(cwd, models, jiti, library);
  if (typeof found === "string") return found;
  const project: ConsoleProject = {
    library,
    models: found,
    reload: async () => {
      forgetProjectFiles(cwd, jiti, libraryFiles);
      const again = await modelsIn(cwd, models, jiti, library);
      if (typeof again !== "string") project.models = again;
      return again;
    },
  };
  return project;
}
