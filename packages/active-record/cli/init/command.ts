// `active-record init`: writes the project's `active-record.jsonc`, naming its databases and their adapters, from what each adapter's plugin finds (#301, #305).
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type { CliAdapter, InitResult } from "../adapter.ts";
import { apply, printed, printing, written, type Plan, type Print } from "../plan.ts";
import { adapterNames, loadAdapters, pluginOf } from "../project/adapters.ts";
import { configFileName, parseJsonc } from "../project/config-file.ts";
import { withEntries } from "./insert.ts";
import { corePackage } from "../project/load.ts";
import { listed } from "../project/names.ts";
import { shown, slashed } from "../project/paths.ts";

/** What `init` was asked: the adapter (`--adapter`), and the file to write (`--config`). */
export interface InitOptions {
  cwd?: string;
  adapter?: string;
  config?: string;
}

/** The databases one adapter's plugin found, by the adapter's name. */
interface Found {
  name: string;
  result: Exclude<InitResult, string | undefined>;
}

/** The JSON Schema the package ships for the file, which editors complete its keys from. */
const schemaFile = "config-schema.json";

/** The core package as the nearest `node_modules` holds it, or as the project's own will. */
function installedCore(cwd: string, dir: string): string {
  for (let at = dir; ; at = dirname(at)) {
    const here = join(at, "node_modules", corePackage);
    if (existsSync(here)) return here;
    if (dirname(at) === at) return join(cwd, "node_modules", corePackage);
  }
}

/** The `$schema` link, from the file's folder to the schema in the installed package. */
function schemaLink(cwd: string, dir: string): string {
  const link = slashed(relative(dir, join(installedCore(cwd, dir), schemaFile)));
  return link.startsWith("../") ? link : `./${link}`;
}

/** The plugin `name`'s entries, chosen with `--adapter`, or why there are none. */
async function chosenEntries(dir: string, name: string): Promise<Found | string> {
  if (!adapterNames.includes(name)) return `--adapter takes ${listed(adapterNames)}, not ${name}`;
  const result = (await pluginOf(name)).init(dir, true);
  if (result === undefined) return `Nothing here declares a database for ${name}`;
  return typeof result === "string" ? result : { name, result };
}

/** The entries of the one adapter something in the project points to, or why there isn't one. */
async function foundEntries(dir: string): Promise<Found | string> {
  const found: Found[] = [];
  for (const name of adapterNames) {
    const result = (await pluginOf(name)).init(dir, false);
    if (typeof result === "string") return result;
    if (result !== undefined) found.push({ name, result });
  }
  if (found.length === 1) return found[0]!;
  if (found.length === 0) {
    return `Nothing here says which database the project uses; choose ${listed(adapterNames)} with --adapter`;
  }
  return (
    `This project could use ${listed(found.map((each) => each.name))}; choose one with ` +
    "--adapter, then run init again with the other to add its databases too"
  );
}

/** The file's text: the schema link, then each database with its adapter first. */
function source(link: string, { name, result }: Found): string {
  const databases = Object.fromEntries(
    Object.entries(result.databases).map(([binding, entry]) => [
      binding,
      { adapter: name, ...entry },
    ]),
  );
  return `${JSON.stringify({ $schema: link, databases }, null, 2)}\n`;
}

/** The plugins whose databases `init` adds to a file: `--adapter`'s, or each one the file names. */
async function pluginsAdding(inFile: CliAdapter[], adapter: string | undefined) {
  if (adapter === undefined) return inFile;
  if (!adapterNames.includes(adapter))
    return `--adapter takes ${listed(adapterNames)}, not ${adapter}`;
  // Once the file names it, every command loads it, so one this Node can't run adds nothing.
  const plugin = await pluginOf(adapter);
  return plugin.unsupported?.() ?? [plugin];
}

/** A database init adds: its binding and adapter, its entry as the plugin wrote it, and any note on it. */
interface Added {
  binding: string;
  adapter: string;
  entry: Record<string, unknown>;
  note?: string;
}

/**
 * The databases `plugins` find in `dir` that the file's `databases` (`inFile`) don't name, each
 * plugin writing what it can when `--adapter` chose an adapter new to the file; or why one can't be
 * read.
 */
function missingFrom(dir: string, plugins: CliAdapter[], inFile: object, newAdapter: boolean) {
  const added: Added[] = [];
  for (const plugin of plugins) {
    const found = plugin.init(dir, newAdapter);
    if (typeof found === "string") return found;
    for (const [binding, entry] of Object.entries(found?.databases ?? {})) {
      if (Object.hasOwn(inFile, binding)) continue;
      added.push({ binding, adapter: plugin.name, entry, note: found?.notes?.[binding] });
    }
  }
  return added;
}

/** The line saying what init added, with the adapter, or each one's when they differ. */
function addedLine(name: string, added: readonly Added[]): string {
  const bindings = listed(
    added.map((each) => each.binding),
    "and",
  );
  const adapters = new Set(added.map((each) => each.adapter));
  const which =
    adapters.size === 1
      ? `on ${added[0]!.adapter}`
      : added.map((each) => `${each.binding} on ${each.adapter}`).join(", ");
  return `Added ${bindings} to ${name} (${which})`;
}

/**
 * What `init` does when the file is there: add each database that the adapters the file names (or
 * the one `--adapter` names) find and the file doesn't name, keeping the rest of the text as
 * written; or say why it can't.
 */
async function planAdding(cwd: string, path: string, options: InitOptions): Promise<Plan> {
  const name = shown(cwd, path);
  const adapters = await loadAdapters(cwd, options.config);
  if (typeof adapters === "string") return printing([adapters], 1);
  const plugins = await pluginsAdding(adapters.plugins, options.adapter);
  if (typeof plugins === "string") return printing([plugins], 1);
  const text = readFileSync(path, "utf8");
  const inFile = (parseJsonc(text) as { databases: Record<string, unknown> }).databases;
  // `--adapter` lets a plugin write what it can only for an adapter the file doesn't use yet.
  const inUse = adapters.plugins.some((each) => each.name === options.adapter);
  const newAdapter = options.adapter !== undefined && !inUse;
  const added = missingFrom(dirname(path), plugins, inFile, newAdapter);
  if (typeof added === "string") return printing([added], 1);
  if (added.length === 0)
    return printing([`${name} names every database init finds; it wrote nothing`]);
  const source = withEntries(
    text,
    added.map(({ binding, adapter, entry }) => [binding, { adapter, ...entry }] as const),
  );
  if (source === undefined) return printing([`${name}'s databases couldn't be found to add to`], 1);
  const notes = added.flatMap((each) => each.note ?? []).map((note) => printed(`Note: ${note}`));
  return { steps: [written({ path, source }, addedLine(name, added)), ...notes], code: 0 };
}

/** What `init` does: write the file, and say what's next; or say why it can't. */
async function planInit(options: InitOptions): Promise<Plan> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const path = resolve(cwd, options.config ?? configFileName);
  const name = shown(cwd, path);
  // lstat, not exists: a link, even to nothing, is never written through.
  const there = lstatSync(path, { throwIfNoEntry: false });
  if (there?.isSymbolicLink() === true) {
    return printing([`${name} is a link; init writes nothing through it`], 1);
  }
  if (there !== undefined) return planAdding(cwd, path, options);
  const dir = dirname(path);
  const found =
    options.adapter === undefined
      ? await foundEntries(dir)
      : await chosenEntries(dir, options.adapter);
  if (typeof found === "string") return printing([found], 1);
  const bindings = listed(Object.keys(found.result.databases), "and");
  const notes = Object.values(found.result.notes ?? {}).map((note) => printed(`Note: ${note}`));
  const file = { path, source: source(schemaLink(cwd, dir), found) };
  return {
    steps: [
      written(file, `Wrote ${name} (${bindings}, on ${found.name})`),
      ...notes,
      printed("Next: npx active-record schema"),
    ],
    code: 0,
  };
}

/** `active-record init`: resolves to the exit code. */
export async function runInit(options: InitOptions, print: Print): Promise<number> {
  return apply(await planInit(options), resolve(options.cwd ?? process.cwd()), print);
}
