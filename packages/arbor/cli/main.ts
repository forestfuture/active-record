// The `active-record` command line. Node only: no Worker imports it (cli/bin.ts runs it).
import { consoleSubcommand } from "./console/flags.ts";
import { generateSubcommand } from "./generate/flags.ts";
import { initSubcommand } from "./init/flags.ts";
import { migrateSubcommand } from "./migrate/flags.ts";
import type { Print } from "./plan.ts";
import { schemaSubcommand } from "./schema/flags.ts";
import { helpFor, type Subcommand } from "./subcommand.ts";

/** Each subcommand by the names it answers to. */
const subcommands: Record<string, Subcommand> = {
  init: initSubcommand,
  schema: schemaSubcommand,
  g: generateSubcommand,
  generate: generateSubcommand,
  console: consoleSubcommand,
  c: consoleSubcommand,
  migrate: migrateSubcommand,
};

/** Each subcommand once, in the order its help is printed. */
export const everySubcommand = [...new Set(Object.values(subcommands))];

const help = helpFor(everySubcommand);

/** Prints the usage, after what went wrong; 1. */
function usage(print: Print, problem: string): number {
  print(`${problem}\n\n${help}`);
  return 1;
}

/**
 * Whether this Node has what the command itself uses: `process.getBuiltinModule`, `fs.globSync`
 * and `path.matchesGlob` (Node 22.5; Node 20 has only the first and last). A plugin says what
 * it needs itself, with `unsupported`.
 */
function isSupportedNode(): boolean {
  // Node before 22.3 (or 20.16) has no getBuiltinModule.
  if (typeof process.getBuiltinModule !== "function") return false;
  const { globSync } = process.getBuiltinModule("node:fs");
  return globSync !== undefined && process.getBuiltinModule("node:path").matchesGlob !== undefined;
}

/** Runs the command line: the exit code, or "watching" while `schema --watch` runs on. */
export function main(
  argv: readonly string[],
  print = console.log,
): number | "watching" | Promise<number | "watching"> {
  const [command = "", ...rest] = argv;
  const subcommand = Object.hasOwn(subcommands, command) ? subcommands[command] : undefined;
  const asked = [command, ...rest].some((arg) => arg === "--help" || arg === "-h");
  if (subcommand === undefined || asked) {
    print(help);
    return asked ? 0 : 1;
  }
  if (!isSupportedNode()) {
    print(
      `active-record ${command} needs Node 22.5 or later (this is Node ${process.versions.node})`,
    );
    return 1;
  }
  return subcommand.run(rest, print, (problem) => usage(print, problem));
}
