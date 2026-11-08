// `active-record migrate` on Postgres: the runner applies the database's migrations to its local url, or with `--remote` its remoteUrl.
import { basename } from "node:path";
import type { ChosenDatabase, MigrateOutput, RemoteTarget } from "@forestfuture/active-record/cli";
import { migrationFiles, runMigrations } from "./runner.ts";
import { connectionString, databaseNameOf, hostOf } from "./urls.ts";

/** A database, named for a person: its binding, its database's name and its host. */
const described = (kind: string, binding: string, url: string) =>
  `${kind} database ${binding} (${databaseNameOf(url)} on ${hostOf(url)})`;

/** The real database the entry's `remoteUrl` names, or why there's none. */
export function remoteTarget({
  binding,
  entry,
  configFile,
}: ChosenDatabase): RemoteTarget | string {
  const url = connectionString(entry, "remoteUrl");
  if (url === undefined)
    return `${binding} has no remoteUrl in ${basename(configFile)}, which --remote needs`;
  if (typeof url !== "string") return url.error;
  return { name: databaseNameOf(url), description: described("Remote", binding, url) };
}

/** The connection string `migrate` uses, and how it names the database, or why there's none. */
function target(
  chosen: ChosenDatabase,
  remote: boolean,
): { url: string; description: string } | string {
  const setting = remote ? "remoteUrl" : "url";
  const url = connectionString(chosen.entry, setting);
  if (url === undefined) {
    const need = remote ? "--remote needs" : "migrate needs for the local database";
    return `${chosen.binding} has no ${setting} in ${basename(chosen.configFile)}, which ${need}`;
  }
  if (typeof url !== "string") return url.error;
  return { url, description: described(remote ? "Remote" : "Local", chosen.binding, url) };
}

/** Applies the chosen database's pending migrations, locally or remotely; the exit code. */
export async function migrate(
  _cwd: string,
  chosen: ChosenDatabase,
  { remote }: { remote: boolean },
  io: MigrateOutput,
): Promise<number> {
  const say = (line: string) => io.output(`${line}\n`);
  const refused = (problem: string) => {
    say(problem);
    return 1;
  };
  const where = target(chosen, remote);
  if (typeof where === "string") return refused(where);
  const files = migrationFiles(chosen.migrationsDir);
  if (typeof files === "string") return refused(files);
  say(where.description);
  return runMigrations(where.url, files, say);
}
