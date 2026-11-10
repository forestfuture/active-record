// The adapters a project's `active-record.jsonc` names, each database's own (#305), their command line plugins, and the databases each reads (#278, #301).
import { basename } from "node:path";
import type { CliAdapter, DatabaseConfig, ProjectDatabases } from "../adapter.ts";
import { projectDatabases } from "./config-file.ts";
import { listed } from "./names.ts";

/** An adapter the command knows: the entry its factory is imported from, and its plugin. */
interface Registered {
  entry: string;
  plugin: () => Promise<CliAdapter>;
}

/** Each adapter a database's `adapter` names. Its plugin ships with the command, loaded when it's used. */
const adapters: Readonly<Record<string, Registered>> = {
  d1: {
    entry: "@forestfuture/active-record/d1",
    plugin: async () => (await import("../adapters/d1/plugin.ts")).cli,
  },
  postgresql: {
    entry: "@forestfuture/active-record/postgresql",
    plugin: async () => (await import("../adapters/postgresql/plugin.ts")).cli,
  },
};

/** The adapters' names, in the registry's order. */
export const adapterNames: readonly string[] = Object.keys(adapters);

/** The entry an adapter's factory and `connect` are imported from, as the registry names it. */
export function adapterEntry(adapter: Pick<CliAdapter, "name">): string {
  return adapters[adapter.name]?.entry ?? adapter.name;
}

/** What's wrong with a database's `adapter`, if anything. */
function adapterError(binding: string, adapter: unknown): string | undefined {
  if (adapter === undefined) {
    const quoted = adapterNames.map((name) => JSON.stringify(name));
    return `databases.${binding} has no adapter (add "adapter": ${listed(quoted)})`;
  }
  if (typeof adapter === "string" && Object.hasOwn(adapters, adapter)) return undefined;
  return `databases.${binding} has the adapter ${JSON.stringify(adapter)}, which isn't ${listed(adapterNames)}`;
}

/** The adapters the project's databases name, each once, in the file's order; or why one won't do. */
function adaptersNamed(project: ProjectDatabases): string[] | string {
  const file = basename(project.file);
  const names: string[] = [];
  for (const [binding, entry] of Object.entries(project.databases)) {
    const error = adapterError(binding, entry.adapter);
    if (error !== undefined) return `${file}: ${error}`;
    if (!names.includes(entry.adapter as string)) names.push(entry.adapter as string);
  }
  return names;
}

/** The plugin of the adapter `name`. */
export function pluginOf(name: string): Promise<CliAdapter> {
  return adapters[name]!.plugin();
}

/** The project's entries, as its `active-record.jsonc` has them, and the plugin of each adapter they name. */
export interface NamedAdapters {
  project: ProjectDatabases;
  /** In the order the file first names each. */
  plugins: CliAdapter[];
}

/**
 * The adapters the project's `active-record.jsonc` (or the file `configPath` names) names, each
 * one's plugin loaded and able to run on this Node; or a message saying what to do.
 */
export async function loadAdapters(
  cwd: string,
  configPath?: string,
): Promise<NamedAdapters | string> {
  const project = projectDatabases(cwd, configPath);
  if (typeof project === "string") return project;
  const names = adaptersNamed(project);
  if (typeof names === "string") return names;
  const plugins = await Promise.all(names.map((name) => pluginOf(name)));
  const unsupported = plugins.map((plugin) => plugin.unsupported?.()).find(Boolean);
  return unsupported ?? { project, plugins };
}

/** The entries the project's file has for one adapter, as its plugin reads them. */
function entriesFor(project: ProjectDatabases, name: string): ProjectDatabases {
  const own = Object.entries(project.databases).filter(([, entry]) => entry.adapter === name);
  return { ...project, databases: Object.fromEntries(own) };
}

/** One of the project's databases: its adapter's plugin, and the config that declares it. */
export interface ProjectDatabase {
  adapter: CliAdapter;
  database: DatabaseConfig;
  /** The file that declares it (its adapter's own config, if it reads one), and its folder. */
  configFile: string;
  configDir: string;
}

/** The project's databases, in its file's order, and what their adapters note about them. */
export interface LoadedProject {
  databases: ProjectDatabase[];
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
  const at = (each: ProjectDatabase) => order.indexOf(each.database.binding);
  loaded.databases.sort((a, b) => at(a) - at(b));
  return loaded;
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
  return typeof named === "string" ? named : databasesOf(named);
}

/** The notes the project's adapters have about its databases, as the command prints them. */
export function configNotes(project: LoadedProject): string[] {
  return project.notes.map((note) => `Note: ${note}`);
}
