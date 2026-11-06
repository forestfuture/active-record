// The D1 adapter's plugin for the `active-record` command (`@forestfuture/d1-record/cli`, #278).
import { dirname, join } from "node:path";
import type { CliAdapter } from "@forestfuture/active-record/cli";
import { openLocalBinding, openRemoteBinding } from "./binding.ts";
import { migrate } from "./migrate.ts";
import { migration } from "./migration.ts";
import { remoteTarget } from "./remote.ts";
import { schemaOf } from "./schema.ts";
import { readWranglerConfig } from "./wrangler.ts";

/** D1, as the command line sees it: Wrangler's config and migrations, SQLite's schema, and its bindings. */
export const cli: CliAdapter = {
  name: "d1",
  patternSetting: "migrations_pattern",
  databases: readWranglerConfig,
  readSchema: async (migrations, options) => schemaOf(migrations, options),
  migration,
  remote: (chosen, use) => remoteTarget(chosen, use),
  // Wrangler's own folder of local state, which Wrangler projects ignore.
  stateFolder: ({ configFile }) => join(dirname(configFile), ".wrangler"),
  open: (cwd, chosen, { remote }) =>
    remote ? openRemoteBinding(cwd, chosen) : openLocalBinding(cwd, chosen),
  migrate,
};
