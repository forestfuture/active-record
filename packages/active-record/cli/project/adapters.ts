// Which adapter a project uses, as its `active-record.jsonc` names it, and that adapter's command line plugin (#278, #301).
import { basename } from "node:path";
import type { CliAdapter, ProjectAdapter, ProjectDatabases } from "../adapter.ts";
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

/** The adapters' names, as a message lists them. */
const names = () => listed(adapterNames);

/** The entry an adapter's factory and `connect` are imported from, as the registry names it. */
export function adapterEntry(adapter: Pick<CliAdapter, "name">): string {
  return adapters[adapter.name]?.entry ?? adapter.name;
}

/** What's wrong with a database's `adapter`, if anything. */
function adapterError(binding: string, adapter: unknown): string | undefined {
  if (adapter === undefined) {
    return `databases.${binding} has no adapter (add "adapter": ${listed(Object.keys(adapters).map((name) => JSON.stringify(name)))})`;
  }
  if (typeof adapter === "string" && Object.hasOwn(adapters, adapter)) return undefined;
  return `databases.${binding} has the adapter ${JSON.stringify(adapter)}, which isn't ${names()}`;
}

/** The one adapter the project's databases name, or why there isn't one (#305). */
function adapterNamed(project: ProjectDatabases): string | { error: string } {
  const file = basename(project.file);
  const entries = Object.entries(project.databases);
  for (const [binding, entry] of entries) {
    const error = adapterError(binding, entry.adapter);
    if (error !== undefined) return { error: `${file}: ${error}` };
  }
  const named = new Set(entries.map(([, entry]) => entry.adapter as string));
  if (named.size === 1) return [...named][0]!;
  const each = entries.map(([binding, entry]) => `${String(entry.adapter)} for ${binding}`);
  return {
    error: `${file} names more than one adapter (${each.join(", ")}); a project uses one, for now`,
  };
}

/** The plugin of the adapter `name`. */
export function pluginOf(name: string): Promise<CliAdapter> {
  return adapters[name]!.plugin();
}

/**
 * The project's adapter, as its `active-record.jsonc` (or the file `configPath` names) names it, with
 * its plugin reading the databases there; or a message saying what to do.
 */
export async function loadAdapter(
  cwd: string,
  configPath?: string,
): Promise<ProjectAdapter | string> {
  const project = projectDatabases(cwd, configPath);
  if (typeof project === "string") return project;
  const name = adapterNamed(project);
  if (typeof name !== "string") return name.error;
  const plugin = await pluginOf(name);
  return plugin.unsupported?.() ?? { ...plugin, databases: () => plugin.databases(project) };
}
