// The adapters a project's `active-record.jsonc` names, each database's own (#305), and their command line plugins (#278, #301).
import { basename } from "node:path";
import type { CliAdapter, ProjectDatabases } from "../adapter.ts";
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
