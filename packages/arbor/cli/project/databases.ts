// The project's databases, each with its adapter's plugin, as the command loads them (#305), and choosing the one a command acts on: the one `--database` names, or else the first.
import { existsSync, realpathSync } from "node:fs";
import { dirname, resolve } from "node:path";
import type { ChosenDatabase, CliAdapter, DatabaseConfig, ProjectDatabases } from "../adapter.ts";
import { isSkippedByMigrate, loadAdapters, type NamedAdapters } from "./adapters.ts";
import { listed } from "./names.ts";
import { shown } from "./paths.ts";

/** The entries the project's file has for one adapter, as its plugin reads them. */
function entriesFor(project: ProjectDatabases, name: string): ProjectDatabases {
  const own = Object.entries(project.databases).filter(([, entry]) => entry.adapter === name);
  return { ...project, databases: Object.fromEntries(own) };
}

/** One of the project's databases: its adapter's plugin, and the config that declares it. */
export interface LoadedDatabase {
  adapter: CliAdapter;
  database: DatabaseConfig;
  /** The file that declares it (its adapter's own config, if it reads one), and its folder. */
  configFile: string;
  configDir: string;
  /** Whether `migrate` migrates it unless named: not when its entry is `"migrate": false` (#313). */
  migrates: boolean;
}

/** A database's migrations folder, as an absolute path: its config's, beside its config file. */
function migrationsFolderOf({ configDir, database }: LoadedDatabase): string {
  return resolve(configDir, database.migrationsDir);
}

/** The project's databases, in its file's order, and what their adapters note about them. */
export interface LoadedProject {
  databases: LoadedDatabase[];
  /** For a person, such as databases an adapter's own config has that the file doesn't name. */
  notes: string[];
}

/** Each adapter's databases, read by its plugin from the entries the file has for it. */
function databasesOf({ project, plugins }: NamedAdapters): LoadedProject | string {
  const loaded: LoadedProject = { databases: [], notes: [] };
  for (const adapter of plugins) {
    const config = adapter.databases(entriesFor(project, adapter.name));
    if (!config.ok) return config.error;
    for (const database of config.databases) {
      const configFile = database.configFile ?? config.file;
      const configDir = database.configFile === undefined ? config.dir : dirname(configFile);
      const migrates = !isSkippedByMigrate(project.databases[database.binding]);
      loaded.databases.push({ adapter, database, configFile, configDir, migrates });
    }
    loaded.notes.push(...(config.notes ?? []));
  }
  const order = Object.keys(project.databases);
  const at = (each: LoadedDatabase) => order.indexOf(each.database.binding);
  loaded.databases.sort((a, b) => at(a) - at(b));
  return loaded;
}

/** A folder with its links followed, when it exists, so a linked folder is the one it links to. */
function onDisk(folder: string): string {
  return existsSync(folder) ? realpathSync.native(folder) : folder;
}

/**
 * Two databases on different adapters reading one migrations folder, as an error: one folder can't
 * hold each adapter's SQL, and the adapters may default to the same folder.
 */
function sharedMigrations(cwd: string, databases: readonly LoadedDatabase[]): string | undefined {
  const seen = new Map<string, LoadedDatabase>();
  for (const each of databases) {
    const other = seen.get(onDisk(migrationsFolderOf(each)));
    if (other !== undefined && other.adapter.name !== each.adapter.name) {
      return `${sharing(cwd, other, each)}, on different adapters (${other.adapter.name} and ${each.adapter.name}); give each its own migrations folder`;
    }
    seen.set(onDisk(migrationsFolderOf(each)), each);
  }
  return undefined;
}

/** That two databases both read one folder, or each one's path when a link makes them one. */
function sharing(cwd: string, first: LoadedDatabase, second: LoadedDatabase): string {
  const [one, two] = [first, second].map((each) => `${shown(cwd, migrationsFolderOf(each))}/`);
  const [a, b] = [first.database.binding, second.database.binding];
  return one === two
    ? `${a} and ${b} both read ${one}`
    : `${a}'s ${one} and ${b}'s ${two} are one folder`;
}

/**
 * The project's databases, each with its own adapter, as its `arbor.jsonc` (or the file
 * `configPath` names) names it (#305); or a message saying what to do.
 */
export async function loadDatabases(
  cwd: string,
  configPath?: string,
): Promise<LoadedProject | string> {
  const named = await loadAdapters(cwd, configPath);
  const loaded = typeof named === "string" ? named : databasesOf(named);
  if (typeof loaded === "string") return loaded;
  return sharedMigrations(cwd, loaded.databases) ?? loaded;
}

/**
 * The project's databases, as a command loads them: having printed what their adapters note about
 * them, or, when they can't be loaded, `undefined`, having printed why.
 */
export async function loadForCommand(
  cwd: string,
  options: { config?: string },
  print: (line: string) => void,
): Promise<LoadedProject | undefined> {
  const loaded = await loadDatabases(cwd, options.config);
  if (typeof loaded === "string") {
    print(loaded);
    return undefined;
  }
  for (const note of loaded.notes) print(`Note: ${note}`);
  return loaded;
}

/**
 * The database a command works on: the one `--database` names, or else the config's first; or, as
 * a message to print, why there isn't one (a name no binding has).
 */
export function chooseDatabase<D extends { binding: string }>(
  databases: readonly D[],
  named: string | undefined,
): D | string {
  if (named === undefined) return databases[0]!;
  const chosen = databases.find((database) => database.binding === named);
  const bindings = listed(databases.map((database) => database.binding));
  return chosen ?? `No database is bound as ${named}; this config has ${bindings}`;
}

/** The database a command acts on, and its adapter's plugin. */
export interface Chosen {
  adapter: CliAdapter;
  chosen: ChosenDatabase;
  /** Whether `migrate` migrates it unless named (`"migrate": false` says not). */
  migrates: boolean;
}

/** A loaded database as a command acts on it, with its adapter. */
function chosenFrom(loaded: LoadedDatabase): Chosen {
  const { adapter, database, configFile, migrates } = loaded;
  const migrationsDir = migrationsFolderOf(loaded);
  return {
    adapter,
    chosen: { binding: database.binding, entry: database.entry, configFile, migrationsDir },
    migrates,
  };
}

/** The database `--database` names (or the first), with its adapter, or why there isn't one. */
export function chosenDatabase(
  project: LoadedProject,
  options: { database?: string },
): Chosen | string {
  const bindings = project.databases.map((each) => ({ ...each, binding: each.database.binding }));
  const found = chooseDatabase(bindings, options.database);
  return typeof found === "string" ? found : chosenFrom(found);
}

/** Every one of the project's databases, in its file's order, each with its adapter. */
export function everyDatabase(project: LoadedProject): Chosen[] {
  return project.databases.map(chosenFrom);
}
