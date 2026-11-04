// What a `d1-record` subcommand declares (flags, help, its action), `defineSubcommand`, which parses a command line for it, and `helpFor`, which joins their help.
import { parseArgs, type ParseArgsOptionsConfig } from "node:util";
import type { Print } from "./plan.ts";

/** The flags every subcommand takes. */
const sharedOptions = {
  config: { type: "string" },
  help: { type: "boolean", short: "h" },
} as const satisfies ParseArgsOptionsConfig;

/** The help for the shared flags, after every subcommand's own. */
const sharedFlagHelp = `Options for every command:
  --config <file>     Use this Wrangler config
  -h, --help          Show this help`;

/** A subcommand's options and the shared ones, as one `parseArgs` table. */
type WithShared<O extends ParseArgsOptionsConfig> = O & typeof sharedOptions;

/** A command line parsed with a subcommand's options: its flags, typed from them, and positionals. */
export type Parsed<O extends ParseArgsOptionsConfig> = ReturnType<
  typeof parseArgs<{ args: string[]; allowPositionals: true; options: WithShared<O> }>
>;

/** What running a subcommand comes to: its exit code, or that it keeps running (`--watch`). */
type Outcome = number | "watching" | Promise<number>;

/** Prints what is wrong with a command line, then the usage; 1. */
type Fail = (problem: string) => number;

/** The help a subcommand gives, which `helpFor` joins into one usage. */
interface SubcommandHelp {
  /** Its Usage line or lines, indented as they're printed. */
  usage: string;
  /** Prose after the Usage lines, if it needs some. */
  notes?: string;
  /** Its "Options for …" block. */
  flagHelp: string;
}

/** A subcommand as written: its help, its flags, and what it does once they're parsed. */
interface SubcommandSpec<O extends ParseArgsOptionsConfig> extends SubcommandHelp {
  /** Its own flags (the shared ones are added). */
  options: O;
  /** What it does once its flags are parsed. */
  action: (parsed: Parsed<O>, print: Print, fail: Fail) => Outcome;
}

/** A subcommand ready to run: it parses the arguments after its name, and runs. */
export interface Subcommand extends SubcommandHelp {
  /** Every flag it takes: the shared ones and its own. */
  options: ParseArgsOptionsConfig;
  run(argv: readonly string[], print: Print, fail: Fail): Outcome;
}

/** A subcommand from its spec: its `action` gets the command line parsed, or `fail` says why it can't be. */
export function defineSubcommand<const O extends ParseArgsOptionsConfig>(
  spec: SubcommandSpec<O>,
): Subcommand {
  const { options: own, action, ...help } = spec;
  const options: WithShared<O> = { ...sharedOptions, ...own };
  return {
    ...help,
    options,
    run(argv, print, fail) {
      let parsed: Parsed<O>;
      try {
        parsed = parseArgs({ args: [...argv], allowPositionals: true, options });
      } catch (error) {
        return fail((error as Error).message);
      }
      return action(parsed, print, fail);
    },
  };
}

/** The usage: every subcommand's Usage lines, its notes, its flags, then the shared flags. */
export function helpFor(subcommands: readonly Subcommand[]): string {
  const usage = `Usage:\n${subcommands.map((subcommand) => subcommand.usage).join("\n")}`;
  const notes = subcommands.flatMap((subcommand) => subcommand.notes ?? []);
  const flags = subcommands.map((subcommand) => subcommand.flagHelp);
  return [usage, ...notes, ...flags, sharedFlagHelp].join("\n\n");
}
