// `arbor migrate`: applies each database's pending migrations through its adapter, or the one `--database` names, locally or remotely (#278, #313).
import type { Readable, Writable } from "node:stream";
import { WriteStream } from "node:tty";
import { confirmRemote } from "../console/confirm.ts";
import {
  chosenDatabase,
  everyDatabase,
  loadForCommand,
  type Chosen,
  type LoadedProject,
} from "../project/databases.ts";

export interface MigrateOptions {
  /** The project's folder; the current one by default. */
  cwd?: string;
  /** The project's config file, in place of its `arbor.jsonc`. */
  config?: string;
  /** The one database to migrate; every one by default. */
  database?: string;
  /** The real database, after its name is typed, instead of the local one. */
  remote?: boolean;
  /** Don't ask first (with `remote`). */
  yes?: boolean;
}

/** Where `migrate` asks, and what it prints. */
export interface MigrateTerminal {
  input: Readable;
  output: Writable;
  /** Whether a person is there to type a database's name. */
  terminal: boolean;
}

const standardIo = (): MigrateTerminal => ({
  input: process.stdin,
  output: process.stdout,
  terminal: process.stdin.isTTY === true && process.stdout instanceof WriteStream,
});

/** Whether the real database may be migrated: `--yes`, or its name typed on a terminal. */
async function allowed(
  target: { name: string; description: string },
  options: MigrateOptions,
  io: MigrateTerminal,
): Promise<string | undefined> {
  if (options.yes === true) return undefined;
  if (!io.terminal)
    return "Migrating a remote database asks you to confirm it: run this on a terminal, or add --yes";
  const consequence = "Its pending migrations are applied to it, and can't be undone from here.";
  const { confirmed, release } = await confirmRemote({
    input: io.input,
    output: io.output,
    target,
    consequence,
  });
  await release();
  return confirmed ? undefined : "Not migrated.";
}

/** The databases to migrate: the one `--database` names, or else every one; or why there isn't one. */
function databasesFor(project: LoadedProject, options: MigrateOptions): Chosen[] | string {
  if (options.database === undefined) return everyDatabase(project);
  const found = chosenDatabase(project, options);
  return typeof found === "string" ? found : [found];
}

/** Why one database may not be migrated remotely, if it may not; after asking, unless `--yes`. */
async function remoteRefusal(
  { adapter, chosen }: Chosen,
  options: MigrateOptions,
  io: MigrateTerminal,
): Promise<string | undefined> {
  const target = adapter.remote(chosen, "migrate");
  return typeof target === "string" ? target : allowed(target, options, io);
}

/** `arbor migrate`: resolves to the exit code, the first failing adapter's when one fails. */
export async function runMigrate(
  options: MigrateOptions,
  print: (line: string) => void,
  io: MigrateTerminal = standardIo(),
): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const project = await loadForCommand(cwd, options, print);
  if (project === undefined) return 1;
  const databases = databasesFor(project, options);
  if (typeof databases === "string") {
    print(databases);
    return 1;
  }
  const remote = options.remote === true;
  for (const each of databases) {
    const refusal = remote ? await remoteRefusal(each, options, io) : undefined;
    if (refusal !== undefined) {
      print(refusal);
      return 1;
    }
    const output = { output: (text: string) => io.output.write(text) };
    const code = await each.adapter.migrate(cwd, each.chosen, { remote }, output);
    if (code !== 0) return code;
  }
  return 0;
}
