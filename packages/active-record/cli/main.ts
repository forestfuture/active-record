// The `active-record` command line. Node only: no Worker imports it (cli/bin.ts runs it).
import { consoleSubcommand } from "./console/flags.ts";
import { generateSubcommand } from "./generate/flags.ts";
import { migrateSubcommand } from "./migrate/flags.ts";
import type { Print } from "./plan.ts";
import { schemaSubcommand } from "./schema/flags.ts";
import { helpFor, type Subcommand } from "./subcommand.ts";

/** Each subcommand by the names it answers to. */
const subcommands: Record<string, Subcommand> = {
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
 * Whether this Node has what the command and its adapters' plugins use (`getBuiltinModule`,
 * `fs.globSync`, `path.matchesGlob`, and the modules a plugin loads when used): 22.13 or later.
 */
function supportedNode(version: string): boolean {
  const [major = 0, minor = 0] = version.split(".").map(Number);
  return major > 22 || (major === 22 && minor >= 13);
}

/** Runs the command line; resolves to the exit code (or never, while watching). */
export function main(
  argv: readonly string[],
  print = console.log,
): number | "watching" | Promise<number> {
  const [command = "", ...rest] = argv;
  const subcommand = Object.hasOwn(subcommands, command) ? subcommands[command] : undefined;
  const asked = [command, ...rest].some((arg) => arg === "--help" || arg === "-h");
  if (subcommand === undefined || asked) {
    print(help);
    return asked ? 0 : 1;
  }
  const node = process.versions.node;
  if (!supportedNode(node)) {
    print(`active-record ${command} needs Node 22.13 or later (this is Node ${node})`);
    return 1;
  }
  return subcommand.run(rest, print, (problem) => usage(print, problem));
}
