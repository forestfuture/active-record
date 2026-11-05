// Choosing the database a command acts on: the only one a project declares, or the one `--database` names.
import type { ChosenDatabase, CliAdapter } from "../adapter.ts";
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
  adapter: CliAdapter,
  cwd: string,
  options: { config?: string; database?: string },
): ChosenDatabase | string {
  const config = adapter.databases(cwd, options.config);
  if (!config.ok) return config.error;
  const chosen = chooseDatabase(config.databases, options.database);
  if (typeof chosen === "string") return chosen;
  const found = { binding: chosen.binding, entry: chosen.entry, configFile: config.file };
  return config.accountId === undefined ? found : { ...found, accountId: config.accountId };
}
