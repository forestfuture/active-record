// Which adapter a project uses, and its command line plugin, loaded from the project's own install (#278).
import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import type { CliAdapter } from "../adapter.ts";
import { isMissing, projectJiti } from "./load.ts";
import { listed } from "./names.ts";

/** Each adapter `--adapter` names, and its package. */
const adapters: Readonly<Record<string, string>> = {
  d1: "@forestfuture/d1-record",
  pg: "@forestfuture/pg-record",
};

/** The packages a `package.json` depends on; none when it isn't there, or isn't JSON. */
function dependenciesIn(file: string): string[] {
  if (!existsSync(file)) return [];
  try {
    const manifest = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;
    return ["dependencies", "devDependencies"].flatMap((field) =>
      Object.keys((manifest[field] as Record<string, unknown> | undefined) ?? {}),
    );
  } catch {
    return [];
  }
}

/** The adapters the nearest `package.json` that lists any depends on, from `cwd` up. */
function listedIn(cwd: string): string[] {
  for (let dir = resolve(cwd); ; dir = dirname(dir)) {
    const names = dependenciesIn(join(dir, "package.json"));
    const found = Object.keys(adapters).filter((name) => names.includes(adapters[name]!));
    if (found.length > 0) return found;
    if (dirname(dir) === dir) return [];
  }
}

/**
 * The adapter's plugin, from the project's copy of its `/cli`, found as the project finds it (its
 * `node_modules`, or a `tsconfig.json` path); undefined when it isn't installed.
 */
async function pluginOf(cwd: string, name: string): Promise<CliAdapter | undefined | string> {
  const entry = `${adapters[name]}/cli`;
  try {
    const source = `export { cli } from "${entry}";`;
    const filename = join(cwd, "active-record-adapter.ts");
    const loaded = (await projectJiti(cwd).evalModule(source, { filename, async: true })) as {
      cli: CliAdapter;
    };
    return loaded.cli;
  } catch (error) {
    if (isMissing(error, entry) || isMissing(error, adapters[name]!)) return undefined;
    return `Couldn't load ${entry}: ${(error as Error).message}`;
  }
}

/** The plugins of the adapters `named`, or the project lists, or else any installed. */
async function installed(cwd: string, named: string | undefined): Promise<CliAdapter[] | string> {
  const listedHere = named === undefined ? listedIn(cwd) : [named];
  const found: CliAdapter[] = [];
  for (const name of listedHere.length > 0 ? listedHere : Object.keys(adapters)) {
    const plugin = await pluginOf(cwd, name);
    if (typeof plugin === "string") return plugin;
    if (plugin !== undefined) found.push(plugin);
  }
  return found;
}

/**
 * The project's adapter plugin: the one `named` (`--adapter`), or the one its `package.json` lists,
 * or, when none lists one (a workspace whose root holds them), the one installed. Several, or
 * none, is a message saying what to do.
 */
export async function loadAdapter(cwd: string, named?: string): Promise<CliAdapter | string> {
  if (named !== undefined && !Object.hasOwn(adapters, named)) {
    return `--adapter takes ${listed(Object.keys(adapters))}, not ${named}`;
  }
  const found = await installed(cwd, named);
  if (typeof found === "string") return found;
  if (found.length === 1) return found[0]!;
  if (found.length > 1) {
    const names = listed(found.map((plugin) => plugin.name));
    return `Several adapters are installed here (${names}); choose one with --adapter`;
  }
  if (named !== undefined)
    return `${adapters[named]} isn't installed here (install it, then try again)`;
  return `No adapter is installed here: install one, such as ${adapters["d1"]}, then try again`;
}
