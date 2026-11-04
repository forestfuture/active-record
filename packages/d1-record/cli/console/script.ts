// Running one piece of code in the console's scope and reporting what it came to: `console -e` (#105).
import { Console } from "node:console";
import { Readable, Writable } from "node:stream";
import { inspect } from "node:util";
import { startSession, type LineOutcome, type SessionOptions } from "./session.ts";

/** What a script printed, for stdout and stderr, and whether it succeeded (0) or not (1). */
export interface ScriptResult {
  exitCode: 0 | 1;
  stdout: string;
  stderr: string;
}

/** A stream that collects what is written to it, as text. */
function collecting(into: string[]): Writable {
  return new Writable({
    write(chunk, _encoding, done) {
      into.push(String(chunk));
      done();
    },
  });
}

/** The result as `node -p` prints it: a string as it is, anything else as inspect shows it. */
function shown(value: unknown, colors: boolean): string {
  return typeof value === "string" ? value : inspect(value, { colors });
}

/**
 * Runs `code` as the console would run a line (top-level `await`, the Models and `db` in scope,
 * each statement inside the project's `withDatabase`). The code's own `console.log` goes to
 * stdout and `console.error` to stderr, as in `node -e`. The last result is printed after them
 * unless it is undefined; a failure prints no result, and its stack on stderr, and no later line
 * runs.
 */
export async function runScript({
  code,
  scope,
  commands,
  withDatabase,
  colors = { result: false, error: false },
}: {
  code: string;
  /** Whether the result, and a failure, are colored: each goes to a stream of its own. */
  colors?: { result: boolean; error: boolean };
} & Pick<SessionOptions, "scope" | "commands" | "withDatabase">): Promise<ScriptResult> {
  let last: LineOutcome | undefined;
  const logged: string[] = [];
  const complained: string[] = [];
  const session = startSession({
    input: Readable.from([`${code}\n`]),
    // The REPL's own prompts and echoes have nowhere to go: the outcome is reported instead.
    output: new Writable({ write: (_chunk, _encoding, done) => done() }),
    scope: {
      ...scope,
      console: new Console({ stdout: collecting(logged), stderr: collecting(complained) }),
    },
    commands,
    withDatabase,
    onLine: (outcome) => {
      if (last?.ok !== false) last = outcome;
    },
  });
  await session.closed;
  const stdout = logged.join("");
  const stderr = complained.join("");
  if (last?.ok === false) {
    const stack = inspect(last.error, { colors: colors.error });
    return { exitCode: 1, stdout, stderr: `${stderr}${stack}\n` };
  }
  const value = last?.value;
  const result = value === undefined ? "" : `${shown(value, colors.result)}\n`;
  return { exitCode: 0, stdout: `${stdout}${result}`, stderr };
}
