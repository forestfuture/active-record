// Which adapter a project uses, as its `active-record.jsonc` names it, and that adapter's command line plugin, loaded from the project's own install (#278, #301).
import { basename, join } from "node:path";
import type { CliAdapter, ProjectAdapter, ProjectDatabases } from "../adapter.ts";
import { projectDatabases } from "./config-file.ts";
import { isMissing, projectJiti } from "./load.ts";
import { listed } from "./names.ts";

/** Each adapter a database's `adapter` names, and its package. */
const adapters: Readonly<Record<string, string>> = {
  d1: "@forestfuture/d1-record",
  pg: "@forestfuture/pg-record",
};

/** The adapters' names, in the registry's order. */
export const adapterNames: readonly string[] = Object.keys(adapters);

/** The adapters' names, as a message lists them. */
const names = () => listed(adapterNames);

/** The package an adapter's plugin came from, as the registry names it. */
export function adapterPackage(adapter: Pick<CliAdapter, "name">): string {
  return adapters[adapter.name] ?? adapter.name;
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

/**
 * The adapter's plugin, from the project's copy of its `/cli`, found as the project finds it (its
 * `node_modules`, or a `tsconfig.json` path); or why it can't be loaded.
 */
export async function pluginOf(cwd: string, name: string): Promise<CliAdapter | string> {
  const entry = `${adapters[name]}/cli`;
  try {
    const source = `export { cli } from "${entry}";`;
    const filename = join(cwd, "active-record-adapter.ts");
    const loaded = (await projectJiti(cwd).evalModule(source, { filename, async: true })) as {
      cli: CliAdapter;
    };
    return loaded.cli;
  } catch (error) {
    if (isMissing(error, entry) || isMissing(error, adapters[name]!)) {
      return `${adapters[name]} isn't installed here (install it, then try again)`;
    }
    return `Couldn't load ${entry}: ${(error as Error).message}`;
  }
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
  const plugin = await pluginOf(cwd, name);
  if (typeof plugin === "string") return plugin;
  return plugin.unsupported?.() ?? { ...plugin, databases: () => plugin.databases(project) };
}
