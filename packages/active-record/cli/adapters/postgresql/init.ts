// What `active-record init` writes on Postgres: each Hyperdrive binding the Wrangler config beside the file declares, with its local database, or else `DATABASE_URL` (#301).
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";
import { parseJsonc, type InitResult } from "@forestfuture/active-record/cli";

/** A Wrangler config's Hyperdrive binding, as `init` reads it. */
interface Hyperdrive {
  binding: string;
  localConnectionString?: string;
}

/** The Hyperdrive bindings in the JSON Wrangler config in `dir`, if any, or why it can't be read. */
function hyperdriveIn(dir: string): { file: string; bindings: Hyperdrive[] } | string | undefined {
  const file = ["wrangler.jsonc", "wrangler.json"]
    .map((name) => join(dir, name))
    .find((path) => existsSync(path));
  if (file === undefined) return undefined;
  let config: { hyperdrive?: unknown };
  try {
    config = parseJsonc(readFileSync(file, "utf8")) as { hyperdrive?: unknown };
  } catch (error) {
    return `${basename(file)} couldn't be read: ${(error as Error).message}`;
  }
  const entries = Array.isArray(config.hyperdrive) ? (config.hyperdrive as Hyperdrive[]) : [];
  const bindings = entries.filter((entry) => typeof entry?.binding === "string");
  return { file, bindings };
}

/** The local database a project's folder suggests, named as Rails names it: `shop_development`. */
function guessedUrl(dir: string): string {
  const name = basename(dir)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  return `postgres://localhost:5432/${name || "app"}_development`;
}

/** A Hyperdrive binding's entry: its local connection string as the `url`, or a guess, noted. */
function entryOf(dir: string, file: string, binding: Hyperdrive) {
  if (typeof binding.localConnectionString === "string") {
    return { entry: { url: binding.localConnectionString } };
  }
  const url = guessedUrl(dir);
  const note = `${binding.binding} has no localConnectionString in ${basename(file)}, so its url is a guess (${url}); set it to your local database`;
  return { entry: { url }, note };
}

/**
 * The Postgres databases for `init`: each Hyperdrive binding in the Wrangler config in `dir`, or,
 * when `--adapter` named PostgreSQL and there's none, `DATABASE_URL` with a guessed local database.
 */
export function init(dir: string, named: boolean): InitResult {
  const found = hyperdriveIn(dir);
  if (typeof found === "string") return found;
  if (found !== undefined && found.bindings.length > 0) {
    const made = found.bindings.map(
      (binding) => [binding.binding, entryOf(dir, found.file, binding)] as const,
    );
    return {
      databases: Object.fromEntries(made.map(([binding, { entry }]) => [binding, entry])),
      notes: made.flatMap(([, { note }]) => (note === undefined ? [] : [note])),
    };
  }
  if (!named) return undefined;
  const url = guessedUrl(dir);
  return {
    databases: { DATABASE_URL: { url } },
    notes: [`its url is a guess (${url}); set it to your local database`],
  };
}
