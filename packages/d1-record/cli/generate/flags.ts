// `d1-record g`'s flags and help, and how they become GenerateOptions.
import { defineSubcommand } from "../subcommand.ts";
import { runGenerate } from "./command.ts";

/** `d1-record g model …` and `d1-record g migration …`. */
export const generateSubcommand = defineSubcommand({
  options: {
    id: { type: "string" },
    "no-timestamps": { type: "boolean" },
    models: { type: "string" },
    database: { type: "string" },
    out: { type: "string" },
  },
  usage: `  d1-record g model <Name> [columns]      Write a CREATE TABLE migration and a Model
  d1-record g migration <Name> [columns]  Write a migration: Create…, Add…To…, Remove…From…, or empty`,
  notes: `Columns are name:type, where the type is string (the default), integer, real, boolean,
datetime, json or references; then ! for NOT NULL, =value for a default, and :unique or
:index for an index. For example: email:string!:unique active:boolean!=false user:references`,
  flagHelp: `Options for g:
  --id integer        Give the table an INTEGER key D1 generates (a TEXT key made in code by default)
  --no-timestamps     Leave out created_at and updated_at
  --models <path>     Write Models here (src/models), or append them to one file (src/models.ts);
                      ApplicationRecord is imported from the same folder
  --database <name>   The D1 binding to use, when the config has several
  --out <file>        The schema file to regenerate, when it isn't src/db/schema.ts`,
  action({ values, positionals }, print, fail) {
    const [kind, name, ...columns] = positionals;
    const { id, "no-timestamps": noTimestamps, help: _, ...flags } = values;
    if ((kind !== "model" && kind !== "migration") || name === undefined) {
      return fail("Name what to generate: g model <Name> or g migration <Name>");
    }
    if (id !== undefined && id !== "integer" && id !== "text") {
      return fail(`--id is integer or text, not ${id}`);
    }
    const timestamps = !noTimestamps;
    return runGenerate(
      { ...flags, kind, name, columns, integerId: id === "integer", timestamps },
      print,
    );
  },
});
