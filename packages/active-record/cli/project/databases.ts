// Choosing the database a command acts on: the only one a project declares, or the one `--database` names.
import { resolve } from "node:path";
import type { ChosenDatabase, CliAdapter } from "../adapter.ts";
import type { LoadedProject } from "./adapters.ts";
import { listed } from "./names.ts";

/**
 * The database a command works on: the only one, or the one `--database` names; or, as a message
 * to print, why there isn't one (several and none named, or a name no binding has).
 */
export function chooseDatabase<D extends { binding: string }>(
  databases: readonly D[],
  named: string | undefined,
): D | string {
  const bindings = listed(databases.map((database) => database.binding));
  if (named === undefined) {
    if (databases.length === 1) return databases[0]!;
    return `This config has several databases; choose one with --database (${bindings})`;
  }
  const chosen = databases.find((database) => database.binding === named);
  return chosen ?? `No database is bound as ${named}; this config has ${bindings}`;
}

/** The database a command acts on, and its adapter's plugin. */
export interface Chosen {
  adapter: CliAdapter;
  chosen: ChosenDatabase;
}

/** The database `--database` names (or the only one), with its adapter, or why there isn't one. */
export function chosenDatabase(
  project: LoadedProject,
  options: { database?: string },
): Chosen | string {
  const bindings = project.databases.map((each) => ({ ...each, binding: each.database.binding }));
  const found = chooseDatabase(bindings, options.database);
  if (typeof found === "string") return found;
  const { adapter, database, configFile, configDir } = found;
  const migrationsDir = resolve(configDir, database.migrationsDir);
  return {
    adapter,
    chosen: { binding: database.binding, entry: database.entry, configFile, migrationsDir },
  };
}
