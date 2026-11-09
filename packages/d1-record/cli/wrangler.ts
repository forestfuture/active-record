// Reads a Worker's Wrangler config: its D1 databases, their migrations folders, and its account_id.
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join } from "node:path";
import {
  parseJsonc,
  type ConfigResult,
  type DatabaseConfig,
  type ProjectDatabases,
} from "@forestfuture/active-record/cli";

const candidates = ["wrangler.jsonc", "wrangler.json", "wrangler.toml"];

/** A TOML basic string's contents, its escapes decoded (`\\` → `\`, `\u00e9` → `é`). */
function basicString(body: string): string {
  return JSON.parse(
    `"${body.replace(/\\U([0-9a-fA-F]{8})/g, (_, hex: string) => {
      const point = String.fromCodePoint(Number.parseInt(hex, 16));
      return JSON.stringify(point).slice(1, -1);
    })}"`,
  ) as string;
}

/** A TOML line's `key = "string"` as `[key, value]`, or undefined for any other line. */
function tomlPair(line: string): [string, string] | undefined {
  const pair = /^([\w-]+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|'([^']*)')/.exec(line);
  if (pair === null) return undefined;
  return [pair[1]!, pair[2] === undefined ? pair[3]! : basicString(pair[2])];
}

/** The `[[d1_databases]]` entries and top-level `account_id` of a wrangler.toml: the keys read. */
function parseToml(text: string): { d1_databases: Record<string, string>[]; account_id?: string } {
  const databases: Record<string, string>[] = [];
  const topLevel: Record<string, string> = {};
  let current: Record<string, string> | undefined = topLevel;
  for (const line of text.split("\n").map((each) => each.trim())) {
    if (line.startsWith("[")) {
      current = /^\[\[\s*d1_databases\s*\]\](\s*#.*)?$/.test(line) ? {} : undefined;
      if (current !== undefined) databases.push(current);
      continue;
    }
    const pair = tomlPair(line);
    if (current !== undefined && pair !== undefined) current[pair[0]] = pair[1];
  }
  return { d1_databases: databases, account_id: topLevel.account_id };
}

/** The parsed config file, or why it couldn't be read. */
function parsed(
  file: string,
): { d1_databases?: Record<string, unknown>[]; account_id?: unknown } | string {
  const text = readFileSync(file, "utf8");
  try {
    return file.endsWith(".toml") ? parseToml(text) : (parseJsonc(text) as object);
  } catch (error) {
    return `${basename(file)} couldn't be read: ${(error as Error).message}`;
  }
}

/** A config entry as a database: its binding, and its migrations' folder, pattern and table. */
function databaseOf(entry: Record<string, unknown>): DatabaseConfig {
  const database: DatabaseConfig = {
    binding: String(entry.binding),
    migrationsDir: typeof entry.migrations_dir === "string" ? entry.migrations_dir : "migrations",
    entry,
  };
  if (typeof entry.migrations_pattern === "string")
    database.migrationsPattern = entry.migrations_pattern;
  if (typeof entry.migrations_table === "string") database.migrationsTable = entry.migrations_table;
  return database;
}

/** The Wrangler config's `d1_databases` entries, each with a binding, or why they can't be read. */
function d1Entries(file: string): Record<string, unknown>[] | string {
  const config = parsed(file);
  if (typeof config === "string") return config;
  const entries = config.d1_databases ?? [];
  if (entries.some((entry) => typeof entry.binding !== "string")) {
    return `${basename(file)} has a d1_databases entry with no binding`;
  }
  return entries;
}

/**
 * The D1 databases a project's `active-record.jsonc` names, as its Wrangler config declares them:
 * `wrangler.jsonc`, `wrangler.json` or `wrangler.toml`, beside `active-record.jsonc`. Wrangler's
 * other D1 databases are left out.
 */
export function readWranglerConfig(project: ProjectDatabases): ConfigResult {
  const name = basename(project.file);
  const file = candidates.map((each) => join(project.dir, each)).find((path) => existsSync(path));
  if (file === undefined) {
    return { ok: false, error: `No wrangler.jsonc, wrangler.json or wrangler.toml beside ${name}` };
  }
  const entries = d1Entries(file);
  if (typeof entries === "string") return { ok: false, error: entries };
  const databases: DatabaseConfig[] = [];
  for (const binding of Object.keys(project.databases)) {
    const entry = entries.find((each) => each.binding === binding);
    if (entry === undefined) {
      return {
        ok: false,
        error: `${name} names ${binding}, which isn't in ${basename(file)}'s d1_databases`,
      };
    }
    databases.push(databaseOf(entry));
  }
  return { ok: true, file, dir: dirname(file), databases };
}

/** The account a Wrangler config names (`account_id`), if it names one and can be read. */
export function accountIdIn(configFile: string): string | undefined {
  const config = parsed(configFile);
  if (typeof config === "string") return undefined;
  return typeof config.account_id === "string" ? config.account_id : undefined;
}
