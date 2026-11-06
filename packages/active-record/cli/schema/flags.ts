// `active-record schema`'s flags and help, and how they become SchemaOptions.
import { defineSubcommand } from "../subcommand.ts";
import { runSchema, watchSchema } from "./command.ts";

/** `active-record schema`, once or watching. */
export const schemaSubcommand = defineSubcommand({
  options: {
    check: { type: "boolean" },
    watch: { type: "boolean" },
    out: { type: "string" },
    migrations: { type: "string" },
    models: { type: "string" },
  },
  usage: `  active-record schema [options]              Generate src/db/schema.ts from your migrations`,
  flagHelp: `Options for schema:
  --check             Fail if the generated schema is out of date (for CI)
  --watch             Regenerate whenever a migration changes
  --out <file>        Write here instead (a folder, with several databases)
  --migrations <dir>  Read migrations from here instead
  --models <dir>      Write ApplicationRecord here (src/models by default)`,
  action({ values, positionals }, print, fail) {
    const { watch, help: _, ...options } = values;
    if (positionals.length > 0) return fail(`Unexpected ${positionals[0]}`);
    if (!watch) return runSchema(options, print);
    // A missing adapter is said by the first run, which watching starts with.
    void watchSchema(options, print);
    return "watching";
  },
});
