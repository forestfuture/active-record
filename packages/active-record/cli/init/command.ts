// `active-record init`: writes the project's `active-record.jsonc`, naming its databases and their adapter, from what that adapter's plugin finds (#301).
import { existsSync, lstatSync, readFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import type { InitResult } from "../adapter.ts";
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
  return `This project could use ${listed(found.map((each) => each.name))}; choose one with --adapter`;
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

/**
 * What `init` does when the file is there: add each database the adapter the file names finds and
 * the file doesn't name, keeping the rest of the text as written; or say why it can't.
 */
async function planAdding(cwd: string, path: string, options: InitOptions): Promise<Plan> {
  const name = shown(cwd, path);
  const adapters = await loadAdapters(cwd, options.config);
  if (typeof adapters === "string") return printing([adapters], 1);
  const adapter = adapters.plugins[0]!;
  if (options.adapter !== undefined && options.adapter !== adapter.name) {
    return printing(
      [
        `${name} names ${adapter.name}; a project uses one adapter, for now, so --adapter ${options.adapter} adds nothing`,
      ],
      1,
    );
  }
  const found = adapter.init(dirname(path), false);
  if (typeof found === "string") return printing([found], 1);
  const text = readFileSync(path, "utf8");
  const named = (parseJsonc(text) as { databases: Record<string, unknown> }).databases;
  const missing = Object.entries(found?.databases ?? {}).filter(
    ([key]) => !Object.hasOwn(named, key),
  );
  if (missing.length === 0)
    return printing([`${name} names every database init finds; it wrote nothing`]);
  const entries = missing.map(
    ([key, entry]) => [key, { adapter: adapter.name, ...entry }] as const,
  );
  const source = withEntries(text, entries);
  if (source === undefined) return printing([`${name}'s databases couldn't be found to add to`], 1);
  const bindings = missing.map(([key]) => key);
  const notes = bindings
    .flatMap((key) => found?.notes?.[key] ?? [])
    .map((note) => printed(`Note: ${note}`));
  const added = `Added ${listed(bindings, "and")} to ${name} (on ${adapter.name})`;
  return { steps: [written({ path, source }, added), ...notes], code: 0 };
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
