// The D1 adapter's plugin for the `active-record` command (#278), which the command imports itself (#301).
import { dirname, join } from "node:path";
import type { CliAdapter } from "@forestfuture/active-record/cli";
import { openLocalBinding, openRemoteBinding } from "./binding.ts";
import { readDatabases } from "./databases.ts";
import { init } from "./init.ts";
import { migrate } from "./migrate.ts";
import { migration } from "./migration.ts";
import { remoteTarget } from "./remote.ts";
import { schemaOf } from "./schema.ts";

/**
 * Why this Node can't read D1 migrations: no node:sqlite, unflagged from 22.13 and 23.4.
 * `getBuiltinModule` itself is there: the command checks for it before it loads a plugin.
 */
function unsupported(): string | undefined {
  if (process.getBuiltinModule("node:sqlite") !== undefined) return undefined;
  const node = process.versions.node;
  return `The D1 adapter needs Node 22.13 or later (23.4 on Node 23), for node:sqlite (this is Node ${node})`;
}

/** D1, as the command line sees it: Wrangler's config and migrations, SQLite's schema, and its bindings. */
export const cli: CliAdapter = {
  name: "d1",
  patternSetting: "migrations_pattern",
  unsupported,
  init,
  databases: readDatabases,
  readSchema: async (migrations, options) => schemaOf(migrations, options),
  migration,
  remote: (chosen, use) => remoteTarget(chosen, use),
  // Wrangler's own folder of local state, which Wrangler projects ignore.
  stateFolder: ({ configFile }) => join(dirname(configFile), ".wrangler"),
  open: (cwd, chosen, { remote }) =>
    remote ? openRemoteBinding(cwd, chosen) : openLocalBinding(cwd, chosen),
  migrate,
};
