// The PostgreSQL adapter's plugin for the `active-record` command (#285), which the command imports itself (#301).
import { dirname, join } from "node:path";
import type { CliAdapter } from "@forestfuture/active-record/cli";
import { readDatabases } from "./config.ts";
import { init } from "./init.ts";
import { migrate } from "./migrate.ts";
import { remoteTarget } from "./targets.ts";
import { migration } from "./migration.ts";
import { openDatabase } from "./open.ts";
import { schemaOf } from "./schema.ts";

/** Postgres, as the command line sees it: `active-record.jsonc`'s databases, PGlite's schema, and `pg`. */
export const cli: CliAdapter = {
  name: "postgresql",
  init,
  databases: readDatabases,
  readSchema: schemaOf,
  migration,
  remote: (chosen) => remoteTarget(chosen),
  // Ignored wherever node_modules is, with no line of its own in .gitignore.
  stateFolder: ({ configFile }) => join(dirname(configFile), "node_modules/.cache/active-record"),
  open: (_cwd, chosen, options) => openDatabase(chosen, options),
  migrate,
};
