// `arbor migrate`'s flags and help, and how they become MigrateOptions.
import { defineSubcommand } from "../subcommand.ts";
import { runMigrate } from "./command.ts";

/** `arbor migrate`: applies the pending migrations, to the local database or the real one. */
export const migrateSubcommand = defineSubcommand({
  options: {
    database: { type: "string" },
    remote: { type: "boolean" },
    yes: { type: "boolean" },
  },
  usage: `  arbor migrate                       Apply your pending migrations to the local database`,
  flagHelp: `Options for migrate:
  --database <name>   Migrate only this database; every one by default
  --remote            Migrate your remote databases instead, after asking you to type each one's name
  --yes               Don't ask first (with --remote); also how to migrate it without a terminal`,
  action({ values, positionals }, print, fail) {
    if (positionals.length > 0) return fail(`Unexpected ${positionals[0]}`);
    const { help: _, ...options } = values;
    if (options.yes && !options.remote) return fail("--yes only goes with --remote");
    return runMigrate(options, print);
  },
});
