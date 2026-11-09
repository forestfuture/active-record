// `active-record migrate` on Postgres: the runner applies the database's migrations to its local url, or with `--remote` its remoteUrl.
import type { ChosenDatabase, MigrateOutput } from "@forestfuture/active-record/cli";
import { target } from "./targets.ts";
import { migrationFiles, runMigrations } from "./runner.ts";

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
  const reached = target(chosen, remote);
  if (typeof reached === "string") return refused(reached);
  const files = migrationFiles(chosen.migrationsDir);
  if (typeof files === "string") return refused(files);
  say(reached.description);
  return runMigrations(reached.url, files, say);
}
