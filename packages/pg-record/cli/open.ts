// The console's database: a `pg` Pool on the database's url, or with `--remote` its remoteUrl, ended when the console closes.
import type { ChosenDatabase, OpenBinding } from "@forestfuture/active-record/cli";
import pg from "pg";
import { target } from "./targets.ts";

/**
 * A Pool on the chosen database, for the project's `connect`: the `pg` this plugin imports is the
 * one the project's pg-record imports, from the same install. It's ended when the console closes.
 */
export async function openDatabase(
  chosen: ChosenDatabase,
  { remote }: { remote: boolean },
): Promise<OpenBinding | string> {
  const where = target(chosen, remote, "the console needs");
  if (typeof where === "string") return where;
  const pool = new pg.Pool({ connectionString: where.url, max: 1 });
  pool.on("error", () => {});
  return { binding: pool, description: where.description, dispose: () => pool.end() };
}
