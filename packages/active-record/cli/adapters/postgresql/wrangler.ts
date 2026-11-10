// Reads a Worker's Wrangler config for its Hyperdrive bindings: `wrangler.jsonc`, `wrangler.json` or `wrangler.toml`, which `init` names its databases from (#301).
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parseJsonc } from "@forestfuture/active-record/cli";

/** A Wrangler config's Hyperdrive binding, as `init` reads it. */
export interface Hyperdrive {
  binding: string;
  localConnectionString?: string;
}

const candidates = ["wrangler.jsonc", "wrangler.json", "wrangler.toml"];

/** A TOML basic string's contents, its escapes decoded (`\\` → `\`, `é` → `é`). */
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

/** The `[[hyperdrive]]` tables of a wrangler.toml, each with its string keys: the ones read. */
function tomlHyperdrive(text: string): Record<string, string>[] {
  const tables: Record<string, string>[] = [];
  let current: Record<string, string> | undefined;
  for (const line of text.split("\n").map((each) => each.trim())) {
    if (line.startsWith("[")) {
      current = /^\[\[\s*hyperdrive\s*\]\](\s*#.*)?$/.test(line) ? {} : undefined;
      if (current !== undefined) tables.push(current);
      continue;
    }
    const pair = tomlPair(line);
    if (current !== undefined && pair !== undefined) current[pair[0]] = pair[1];
  }
  return tables;
}

/** The config's `hyperdrive` entries, as written, or why it can't be read. */
function entriesIn(file: string): unknown[] | string {
  const text = readFileSync(file, "utf8");
  if (file.endsWith(".toml")) return tomlHyperdrive(text);
  try {
    const config = parseJsonc(text) as { hyperdrive?: unknown };
    return Array.isArray(config.hyperdrive) ? config.hyperdrive : [];
  } catch (error) {
    return `${basename(file)} couldn't be read: ${(error as Error).message}`;
  }
}

/** The Hyperdrive bindings in the Wrangler config in `dir`, if it has one, or why it can't be read. */
export function hyperdriveIn(
  dir: string,
): { file: string; bindings: Hyperdrive[] } | string | undefined {
  const file = candidates.map((name) => join(dir, name)).find((path) => existsSync(path));
  if (file === undefined) return undefined;
  const entries = entriesIn(file);
  if (typeof entries === "string") return entries;
  const bindings = (entries as Partial<Hyperdrive>[]).filter(
    (entry): entry is Hyperdrive => typeof entry?.binding === "string",
  );
  return { file, bindings };
}
