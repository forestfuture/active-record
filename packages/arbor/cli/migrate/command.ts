// `arbor migrate`: applies each database's pending migrations through its adapter, or the one `--database` names, locally or remotely (#278, #313).
import type { Readable, Writable } from "node:stream";
import { WriteStream } from "node:tty";
import type { RemoteTarget } from "../adapter.ts";
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
  target: RemoteTarget,
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

/**
 * The databases to migrate: the one `--database` names, or else every one; but never one set to
 * `"migrate": false`. Or why there isn't one.
 */
function databasesFor(project: LoadedProject, options: MigrateOptions): Chosen[] | string {
  if (options.database === undefined) return everyDatabase(project).filter((each) => each.migrates);
  const found = chosenDatabase(project, options);
  if (typeof found === "string") return found;
  if (!found.migrates) return `${found.chosen.binding} is set not to migrate ("migrate": false)`;
  return [found];
}

/** Each database's remote target, as its adapter names it; or why one can't be reached. */
function remoteTargets(databases: readonly Chosen[]): RemoteTarget[] | string {
  const targets: RemoteTarget[] = [];
  for (const { adapter, chosen } of databases) {
    const target = adapter.remote(chosen, "migrate");
    if (typeof target === "string") return target;
    targets.push(target);
  }
  return targets;
}

/**
 * Why the databases may not be migrated remotely: one that can't be reached, before anything is
 * asked; or, unless `--yes`, a name not typed, each asked in turn before any is migrated.
 */
async function remoteRefusal(
  databases: readonly Chosen[],
  options: MigrateOptions,
  io: MigrateTerminal,
): Promise<string | undefined> {
  const targets = remoteTargets(databases);
  if (typeof targets === "string") return targets;
  for (const target of targets) {
    const refusal = await allowed(target, options, io);
    if (refusal !== undefined) return refusal;
  }
  return undefined;
}

/** Migrates each database in turn, stopping at the first that fails: its code, or 0. */
async function migrateEach(
  cwd: string,
  databases: readonly Chosen[],
  remote: boolean,
  io: MigrateTerminal,
): Promise<number> {
  const output = { output: (text: string) => io.output.write(text) };
  for (const { adapter, chosen } of databases) {
    const code = await adapter.migrate(cwd, chosen, { remote }, output);
    if (code !== 0) return code;
  }
  return 0;
}

/** Prints why `migrate` won't go on: exit code 1. */
function refused(why: string, print: (line: string) => void): number {
  print(why);
  return 1;
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
  if (typeof databases === "string") return refused(databases, print);
  if (databases.length === 0) {
    print('No database to migrate: each is set not to ("migrate": false)');
    return 0;
  }
  const remote = options.remote === true;
  const refusal = remote ? await remoteRefusal(databases, options, io) : undefined;
  if (refusal !== undefined) return refused(refusal, print);
  return migrateEach(cwd, databases, remote, io);
}
