// `d1-record console`'s flags and help, and how they become ConsoleOptions.
import type { ParseArgsOptionsConfig } from "node:util";
import { defineSubcommand, type Parsed } from "../subcommand.ts";
import { runConsole, type ConsoleOptions } from "./command.ts";

// Declared apart from the subcommand, because ConsoleValues is typed from it.
const options = {
  database: { type: "string" },
  models: { type: "string" },
  history: { type: "boolean" },
  "no-history": { type: "boolean" },
  verbose: { type: "boolean" },
  remote: { type: "boolean" },
  yes: { type: "boolean" },
  eval: { type: "string", short: "e", multiple: true },
} as const satisfies ParseArgsOptionsConfig;

/** The console's parsed flags. */
type ConsoleValues = Parsed<typeof options>["values"];

/** What is wrong with the flags together, if anything. */
function flagProblem(values: ConsoleValues): string | undefined {
  if (values.history && values["no-history"]) return "Use --history or --no-history, not both";
  if (values.yes && !values.remote) return "--yes only goes with --remote";
  const code = values.eval ?? [];
  if (code.length > 1) return "Use -e once; join statements with ;";
  if (code[0]?.trim() === "") return "-e needs some code to run";
  return undefined;
}

/** The console's options from its parsed flags. */
function consoleChoices(values: ConsoleValues): ConsoleOptions {
  const { history, "no-history": noHistory, eval: code, help: _, ...flags } = values;
  return { ...flags, history: noHistory ? false : history || undefined, eval: code?.[0] };
}

/** `d1-record console`: opens the project's database (local, or remote) and its Models in a REPL. */
export const consoleSubcommand = defineSubcommand({
  options,
  usage: `  d1-record console (or c)                Open a console on your D1 database, with your Models`,
  flagHelp: `Options for console:
  --database <name>   The D1 binding to open, when the config has several
  --models <path>     Where the Models are: a folder (src/models) or one file (src/models.ts)
  --remote            Open your remote database instead, after asking you to type its name
  --yes               Don't ask first (with --remote); also how to open it without a terminal
  --history           Keep what you type, which a remote session doesn't unless asked
  --no-history        Don't keep what you type in .wrangler/d1-record-history
  --verbose           Print each statement a line runs (.verbose toggles it while it runs)
  -e, --eval <code>   Run this code, print its result, and exit (only the result goes to stdout)`,
  action({ values, positionals }, print, fail) {
    if (positionals.length > 0) return fail(`Unexpected ${positionals[0]}`);
    const problem = flagProblem(values);
    if (problem !== undefined) return fail(problem);
    return runConsole(consoleChoices(values), print);
  },
});
