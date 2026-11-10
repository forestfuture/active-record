// The project's databases, each with its adapter's plugin, as the command loads them (#305), and choosing the one a command acts on: the only one, or the one `--database` names.
import { existsSync, realpathSync } from "node:fs";
import { resolve } from "node:path";
import type { ChosenDatabase, CliAdapter, DatabaseConfig, ProjectDatabases } from "../adapter.ts";
import { loadAdapters, type NamedAdapters } from "./adapters.ts";
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
    const { file: configFile, dir: configDir } = config;
    for (const database of config.databases) {
      loaded.databases.push({ adapter, database, configFile, configDir });
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
    const folder = migrationsFolderOf(each);
    const other = seen.get(onDisk(folder));
    if (other !== undefined && other.adapter.name !== each.adapter.name) {
      const names = `${other.database.binding} and ${each.database.binding}`;
      const adapters = `${other.adapter.name} and ${each.adapter.name}`;
      return `${names} both read ${shown(cwd, folder)}/, on different adapters (${adapters}); give each its own migrations folder`;
    }
    seen.set(onDisk(folder), each);
  }
  return undefined;
}

/**
 * The project's databases, each with its own adapter, as its `active-record.jsonc` (or the file
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

/** The notes the project's adapters have about its databases, as the command prints them. */
export function configNotes(project: LoadedProject): string[] {
  return project.notes.map((note) => `Note: ${note}`);
}

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
  const { adapter, database, configFile } = found;
  const migrationsDir = migrationsFolderOf(found);
  return {
    adapter,
    chosen: { binding: database.binding, entry: database.entry, configFile, migrationsDir },
  };
}
