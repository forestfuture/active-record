// Reads a Worker's Wrangler config (D1 databases, migrations folders, account_id) and chooses one database.
import { existsSync, readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { listed } from "./names.ts";

/** One D1 database a Worker binds, and where its migrations are. */
export interface DatabaseConfig {
  binding: string;
  /** Its `database_name`, which Wrangler's commands take. */
  databaseName?: string;
  /** Relative to the config file. */
  migrationsDir: string;
  /** Cloudflare's `migrations_pattern`, a glob for nested layouts. */
  migrationsPattern?: string;
  migrationsTable?: string;
  /** The `d1_databases` entry as the config has it (a TOML config's string values only). */
  entry: Record<string, unknown>;
}

export type ConfigResult =
  | { ok: true; file: string; dir: string; databases: DatabaseConfig[]; accountId?: string }
  | { ok: false; error: string };

const candidates = ["wrangler.jsonc", "wrangler.json", "wrangler.toml"];

/** JSON with comments and trailing commas, as wrangler.jsonc allows. */
function parseJsonc(text: string): unknown {
  let out = "";
  for (let index = 0; index < text.length; index++) {
    const char = text[index]!;
    if (char === '"') {
      const end = endOfString(text, index);
      out += text.slice(index, end);
      index = end - 1;
    } else if (text.startsWith("//", index)) {
      index = text.indexOf("\n", index) - 1;
      if (index < 0) break;
    } else if (text.startsWith("/*", index)) {
      const end = text.indexOf("*/", index + 2);
      if (end < 0) throw new SyntaxError("Unterminated /* comment");
      index = end + 1;
    } else out += char;
  }
  return JSON.parse(out.replace(/,(\s*[}\]])/g, "$1"));
}

/** Just past the string literal starting at `start`. */
function endOfString(text: string, start: number): number {
  let index = start + 1;
  while (index < text.length && text[index] !== '"') index += text[index] === "\\" ? 2 : 1;
  return index + 1;
}

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
  if (typeof entry.database_name === "string") database.databaseName = entry.database_name;
  return database;
}

/**
 * The D1 databases in a project's Wrangler config: `wrangler.jsonc`, `wrangler.json` or
 * `wrangler.toml` in `cwd`, or the file `--config` names.
 */
export function readWranglerConfig(cwd: string, configPath?: string): ConfigResult {
  const file =
    configPath === undefined
      ? candidates.map((name) => join(cwd, name)).find((path) => existsSync(path))
      : resolve(cwd, configPath);
  if (file === undefined || !existsSync(file)) {
    return {
      ok: false,
      error: "No wrangler.jsonc, wrangler.json or wrangler.toml here (pass --config)",
    };
  }
  const config = parsed(file);
  if (typeof config === "string") return { ok: false, error: config };
  const entries = config.d1_databases ?? [];
  if (entries.length === 0) return { ok: false, error: `${basename(file)} has no d1_databases` };
  if (entries.some((entry) => typeof entry.binding !== "string")) {
    return { ok: false, error: `${basename(file)} has a d1_databases entry with no binding` };
  }
  const found = { ok: true, file, dir: dirname(file), databases: entries.map(databaseOf) } as const;
  return typeof config.account_id === "string" ? { ...found, accountId: config.account_id } : found;
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
    return `This config has several D1 databases; choose one with --database (${bindings})`;
  }
  const chosen = databases.find((database) => database.binding === named);
  return chosen ?? `No D1 database is bound as ${named}; this config has ${bindings}`;
}
