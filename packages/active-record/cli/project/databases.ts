// Choosing the database a command acts on: the only one a project declares, or the one `--database` names.
import { resolve } from "node:path";
import type { ChosenDatabase, ProjectAdapter } from "../adapter.ts";
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

/** The database for `--database` (and `--config`), with its config file, or why there isn't one. */
export function chosenDatabase(
  adapter: ProjectAdapter,
  cwd: string,
  options: { config?: string; database?: string },
): ChosenDatabase | string {
  const config = adapter.databases();
  if (!config.ok) return config.error;
  const chosen = chooseDatabase(config.databases, options.database);
  if (typeof chosen === "string") return chosen;
  const { binding, entry } = chosen;
  const migrationsDir = resolve(config.dir, chosen.migrationsDir);
  return { binding, entry, configFile: config.file, migrationsDir };
}
