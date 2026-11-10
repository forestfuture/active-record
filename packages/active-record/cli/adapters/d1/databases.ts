// The D1 databases a project's `active-record.jsonc` names, each read from its Wrangler config: the one beside the file, or the one its entry's `wranglerConfig` names (#306).
import { statSync } from "node:fs";
import { basename, relative, resolve, sep } from "node:path";
import {
  listed,
  type ConfigResult,
  type DatabaseConfig,
  type ProjectDatabases,
} from "@forestfuture/active-record/cli";
import { candidates, d1Entries, databaseOf, wranglerConfigIn } from "./wrangler.ts";

/** A database's Wrangler config, or why it has none. */
type Found = { file: string } | { error: string };

/**
 * A path as a message names it: relative to `active-record.jsonc`'s folder, with forward slashes,
 * and that folder itself as `.`.
 */
function shown(project: ProjectDatabases, path: string): string {
  return relative(project.dir, path).split(sep).join("/") || ".";
}

/** The Wrangler config a database's entry names with `wranglerConfig`, or why it can't be read. */
function namedConfig(binding: string, named: unknown, project: ProjectDatabases): Found {
  const setting = `${basename(project.file)}: databases.${binding}.wranglerConfig`;
  if (typeof named !== "string") return { error: `${setting} isn't a string` };
  const file = resolve(project.dir, named);
  const settingNames = `${setting} names ${shown(project, file)}`;
  const stat = statSync(file, { throwIfNoEntry: false });
  if (stat === undefined) return { error: `${settingNames}, which isn't there` };
  if (stat.isDirectory()) {
    return { error: `${settingNames}, which is a folder; name its ${listed(candidates)}` };
  }
  return { file };
}

/**
 * A database's Wrangler config: the one its entry names, or else `beside`, the one beside the file.
 */
function configOf(
  binding: string,
  entry: Record<string, unknown>,
  project: ProjectDatabases,
  beside: string | undefined,
): Found {
  if (entry.wranglerConfig !== undefined)
    return namedConfig(binding, entry.wranglerConfig, project);
  if (beside !== undefined) return { file: beside };
  return { error: `No ${listed(candidates)} beside ${basename(project.file)}` };
}

/**
 * A note for the D1 databases a Wrangler config has that `active-record.jsonc` doesn't name, which
 * the command leaves out, so one added to Wrangler's config alone isn't missed in silence (#301).
 * `init` adds those in the config beside the file; one elsewhere is added by hand (#306).
 */
function unnamed(
  entries: Record<string, unknown>[],
  project: ProjectDatabases,
  file: string,
  beside: string | undefined,
) {
  const left = entries
    .map((entry) => String(entry.binding))
    .filter((binding) => !Object.hasOwn(project.databases, binding));
  if (left.length === 0) return [];
  const one = left.length === 1;
  const which = `the D1 database${one ? "" : "s"} ${listed(left, "and")}`;
  const path = shown(project, file);
  const add =
    file === beside
      ? `run \`npx active-record init\` to add ${one ? "it" : "them"}`
      : `add ${one ? "it" : "each"} with "wranglerConfig": ${JSON.stringify(path)}`;
  return [`${path} has ${which}, which ${basename(project.file)} doesn't name; ${add}`];
}

/**
 * The D1 databases a project's `active-record.jsonc` names, each as its Wrangler config declares
 * it: the config its entry's `wranglerConfig` names, relative to the file, or else `wrangler.jsonc`,
 * `wrangler.json` or `wrangler.toml` beside the file. Wrangler's other D1 databases are left out.
 */
export function readDatabases(project: ProjectDatabases): ConfigResult {
  const name = basename(project.file);
  const beside = wranglerConfigIn(project.dir);
  const entriesByConfig = new Map<string, Record<string, unknown>[]>();
  const databases: DatabaseConfig[] = [];
  for (const [binding, settings] of Object.entries(project.databases)) {
    const found = configOf(binding, settings, project, beside);
    if ("error" in found) return { ok: false, error: found.error };
    const entries = entriesByConfig.get(found.file) ?? d1Entries(found.file);
    if (typeof entries === "string") return { ok: false, error: entries };
    entriesByConfig.set(found.file, entries);
    const entry = entries.find((each) => each.binding === binding);
    if (entry === undefined) {
      const error = `${name} names ${binding}, which isn't in ${shown(project, found.file)}'s d1_databases`;
      return { ok: false, error };
    }
    databases.push({ ...databaseOf(entry), configFile: found.file });
  }
  const notes = [...entriesByConfig].flatMap(([file, entries]) =>
    unnamed(entries, project, file, beside),
  );
  return { ok: true, file: project.file, dir: project.dir, databases, notes };
}
