// `active-record migrate`: applies a database's pending migrations through its adapter, locally or remotely (#278).
import type { Readable, Writable } from "node:stream";
import { WriteStream } from "node:tty";
import { confirmRemote } from "../console/confirm.ts";
import { configNotes, loadAdapter } from "../project/adapters.ts";
import { chosenDatabase } from "../project/databases.ts";

export interface MigrateOptions {
  /** The project's folder; the current one by default. */
  cwd?: string;
  /** The project's config file, in place of its `active-record.jsonc`. */
  config?: string;
  /** The database to migrate, when the config has several. */
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

/** `active-record migrate`: resolves to the exit code, the adapter's own when it ran. */
export async function runMigrate(
  options: MigrateOptions,
  print: (line: string) => void,
  io: MigrateTerminal = standardIo(),
): Promise<number> {
  const cwd = options.cwd ?? process.cwd();
  const adapter = await loadAdapter(cwd, options.config);
  if (typeof adapter === "string") {
    print(adapter);
    return 1;
  }
  for (const note of configNotes(adapter)) print(note);
  const chosen = chosenDatabase(adapter, cwd, options);
  if (typeof chosen === "string") {
    print(chosen);
    return 1;
  }
  const remote = options.remote === true;
  if (remote) {
    const target = adapter.remote(chosen, "migrate");
    const refusal = typeof target === "string" ? target : await allowed(target, options, io);
    if (refusal !== undefined) {
      print(refusal);
      return 1;
    }
  }
  return adapter.migrate(cwd, chosen, { remote }, { output: (text) => io.output.write(text) });
}
