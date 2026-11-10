// What `active-record init` writes on Postgres: each Hyperdrive binding the Wrangler config beside the file declares, with its local database, or else `DATABASE_URL` (#301).
import { basename } from "node:path";
import type { InitResult } from "@forestfuture/active-record/cli";
import { hyperdriveIn, type Hyperdrive } from "./wrangler.ts";

/** The local database a project's folder suggests, named as Rails names it: `shop_development`. */
function guessedUrl(dir: string): string {
  const name = basename(dir)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");
  return `postgres://localhost:5432/${name || "app"}_development`;
}

/** A database's entry with a guessed local `url`, and a note naming it, with why it's a guess. */
function guessed(dir: string, binding: string, why = "") {
  const url = guessedUrl(dir);
  const note = `${binding}${why ? ` ${why}, so its` : "'s"} url is a guess (${url}); set it to your local database`;
  return { entry: { url }, note };
}

/** A Hyperdrive binding's entry: its local connection string as the `url`, or a guess, noted. */
function entryOf(
  dir: string,
  file: string,
  binding: Hyperdrive,
): { entry: { url: string }; note?: string } {
  if (typeof binding.localConnectionString === "string") {
    return { entry: { url: binding.localConnectionString } };
  }
  return guessed(dir, binding.binding, `has no localConnectionString in ${basename(file)}`);
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
  const { entry, note } = guessed(dir, "DATABASE_URL");
  return { databases: { DATABASE_URL: entry }, notes: [note] };
}
