// `active-record init`'s flags and help, and how they become InitOptions.
import { defineSubcommand } from "../subcommand.ts";
import { runInit } from "./command.ts";

/** `active-record init`: writes the project's active-record.jsonc. */
export const initSubcommand = defineSubcommand({
  options: { adapter: { type: "string" } },
  usage: `  active-record init                          Write active-record.jsonc, which names your databases`,
  flagHelp: `Options for init:
  --adapter <name>    The adapter, when the project could use several, or nothing says which;
                      with the file there, adds that adapter's databases`,
  action({ values, positionals }, print, fail) {
    if (positionals.length > 0) return fail(`Unexpected ${positionals[0]}`);
    const { help: _, ...options } = values;
    return runInit(options, print);
  },
});
