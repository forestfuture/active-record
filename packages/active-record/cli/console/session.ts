// A console session: a REPL on any streams (or a script, one outcome per line), with the project's Models and database in scope (#104, #105).
import { AsyncLocalStorage } from "node:async_hooks";
import { inspect, types } from "node:util";
import repl from "node:repl";
import { PassThrough, type Readable, type Writable } from "node:stream";

/** A command of the console itself, typed as `.name` (and `name!` too, when `bang` is set). */
export interface SessionCommand {
  /** What `.help` says about it. */
  help: string;
  /** Also runs as a line that is just `name!`. */
  bang?: boolean;
  /**
   * Runs it, with what was typed after the name and the session's scope (to change what is
   * named); resolves with what to print.
   */
  run: (argument: string, scope: Record<string, unknown>) => Promise<string> | string;
}

/** What one line came to: its value, or what it threw (or was rejected with). */
export type LineOutcome = { ok: true; value: unknown } | { ok: false; error: unknown };

export interface SessionOptions {
  input: Readable;
  output: Writable;
  /** A terminal gets colors, line editing and history; piped input gets plain text. */
  terminal?: boolean;
  /** Where to keep what was typed, between sessions; only a terminal has history. */
  historyFile?: string;
  /** What is shown before each line; `> ` by default. */
  prompt?: string;
  /** What the session can name: the Models, and `db`. */
  scope: Record<string, unknown>;
  /** The console's own commands, by name. */
  commands?: Record<string, SessionCommand>;
  /** The project's own `withDatabase`, bound to its database: runs `run` with Models using it. */
  withDatabase: (run: () => void) => Promise<void>;
  /**
   * Makes the session a script: each line's outcome goes here, and nothing is printed for it. The
   * first line that fails ends the session, so the lines behind it never run.
   */
  onLine?: (outcome: LineOutcome) => void;
}

/** The callback the REPL gives `eval`, which is called with a line's error or its result. */
type EvalCallback = Parameters<repl.REPLEval>[3];

/** How a script session hears of each line: what it came to, and the last thing the REPL wrote. */
interface Script {
  report: (outcome: LineOutcome) => void;
  /** What the REPL wrote for the line in flight (boxed, as undefined is a value); none if nothing. */
  written: () => { value: unknown } | undefined;
  /** Forgets what was written: a new line begins. */
  reset: () => void;
}

/** A line that is just `quit` or `exit`: leaves the console, as `.exit` does. */
const leaving = /^\s*(?:quit|exit)\s*;?\s*$/;

/** A line that is just `name!`: one of the console's commands, as a bare word. */
const bangLine = /^\s*([A-Za-z_]\w*)!\s*;?\s*$/;

/**
 * Runs a task inside the project's database. While a line awaits, the REPL holds the next one back
 * and then runs it from inside that line's async context, where the database is already
 * registered. Wrapping it again would register it twice, which reads as "several databases": so a
 * task already inside one isn't wrapped.
 */
function databaseRunner(withDatabase: SessionOptions["withDatabase"]): (task: () => void) => void {
  const wrapped = new AsyncLocalStorage<true>();
  return (task) => {
    if (wrapped.getStore() === true) task();
    else void withDatabase(() => wrapped.run(true, task));
  };
}

/**
 * What each line of a script came to. A line's callback has its value or what it threw; a rejected
 * `await` never calls back, so then it is what the REPL wrote. Half a statement (a `Recoverable`)
 * is not an outcome: the REPL waits for the rest of it. The first failure closes the session.
 */
function scripted(script: Script | undefined, close: () => void) {
  let outcome: LineOutcome | undefined;
  let unfinished = false;
  return {
    /** The callback to evaluate the next line with. */
    start(callback: EvalCallback): EvalCallback {
      outcome = undefined;
      unfinished = false;
      script?.reset();
      if (script === undefined) return callback;
      return (error, result) => {
        if (error instanceof repl.Recoverable) unfinished = true;
        else outcome = error === null ? { ok: true, value: result } : { ok: false, error };
        callback(error, result);
      };
    },
    /** The input ended: a statement left unfinished is a failure, as the REPL would drop it. */
    ended(): void {
      if (script !== undefined && unfinished) {
        script.report({ ok: false, error: new SyntaxError("Unexpected end of input") });
      }
    },
    /** The REPL asked for the next line: the one in flight is over. */
    finish(): void {
      if (script === undefined || unfinished) return;
      // No callback and nothing written is a console command or a REPL's own (`.help`): it ran.
      const wrote = script.written();
      const reported: LineOutcome =
        outcome ??
        (wrote === undefined ? { ok: true, value: undefined } : { ok: false, error: wrote.value });
      script.report(reported);
      if (!reported.ok) close();
    },
  };
}

/**
 * The REPL's lines, run one at a time inside the project's `withDatabase`. The REPL's input events
 * don't inherit an async context, so each line gets its own: the Models' statics find the
 * session's database, and so do the records they load. Lines pasted or piped arrive together, but
 * each waits for the one before it (an `await` in the first may be what the second uses).
 */
function lineQueue() {
  let tail: Promise<void> = Promise.resolve();
  let lineDone: (() => void) | undefined;
  let stopped = false;
  return {
    /** Settles when every line so far has finished; a later line makes the next one. */
    pending: () => tail,
    /** Runs `task` after the lines before it, and before the ones after. It must not throw. */
    enqueue(task: () => Promise<void>): void {
      tail = tail.then(() => (stopped ? undefined : task()));
    },
    attach(
      server: repl.REPLServer,
      withDatabase: SessionOptions["withDatabase"],
      /** Runs the line if it is a command typed as `name!`; undefined when it is not. */
      command: (line: string) => Promise<void> | undefined,
      script?: Script,
    ): void {
      const evaluate = server.eval;
      const inTheDatabase = databaseRunner(withDatabase);
      // A line is done when the REPL asks for the next: it doesn't call the eval callback for an
      // `await` that rejects, but it always shows the prompt again.
      const displayPrompt = server.displayPrompt.bind(server);
      const tracker = scripted(script, () => {
        stopped = true;
        server.close();
      });
      server.once("exit", () => tracker.ended());
      server.displayPrompt = (preserveCursor) => {
        try {
          displayPrompt(preserveCursor);
        } finally {
          tracker.finish();
          lineDone?.();
        }
      };
      const inDatabase: repl.REPLEval = (code, context, file, callback) => {
        // The REPL ends a line it evaluates with a newline. Its completion evaluates the
        // receiver of what is being typed (`try { await User } catch {}`) through this same
        // function while a person types: those never end in a prompt, so they must not wait in
        // the queue (or hold it up), but they still run where Models find their database.
        if (!code.endsWith("\n")) {
          inTheDatabase(() => evaluate.call(server, code, context, file, callback));
          return;
        }
        tail = tail.then(
          () =>
            new Promise<void>((done) => {
              if (stopped) return done();
              const ran = command(code);
              if (ran !== undefined) {
                void ran.then(done);
                return;
              }
              if (leaving.test(code)) {
                // As `.exit` does: nothing is evaluated, so nothing is printed.
                stopped = true;
                server.close();
                return done();
              }
              lineDone = done;
              const settled = tracker.start(callback);
              inTheDatabase(() => evaluate.call(server, code, context, file, settled));
            }),
        );
      };
      // Typed read-only, but Node's REPL calls `eval` afresh for each line.
      (server as { eval: repl.REPLEval }).eval = inDatabase;
    },
  };
}

/**
 * Piped input as the REPL sees it: its end waits until every line has finished. The REPL closes at
 * once when its input ends, even with an `await` still running, and then shows no more prompts.
 */
function untilDrained(input: Readable, pending: () => Promise<void>): Readable {
  const gated = new PassThrough();
  input.pipe(gated, { end: false });
  input.once("end", () => {
    // The lines of the last chunk reach the REPL (and the queue) before the queue is awaited.
    setImmediate(async () => {
      let last: Promise<void>;
      do {
        last = pending();
        await last;
      } while (last !== pending());
      gated.end();
    });
  });
  return gated;
}

/**
 * The console's own commands, which run in line order, print what they say and ask for the next
 * line. Returns the function that runs a line typed as `name!`, or undefined when it isn't one.
 */
function defineCommands(
  server: repl.REPLServer,
  commands: Record<string, SessionCommand>,
  lines: ReturnType<typeof lineQueue>,
  output: Writable,
): (line: string) => Promise<void> | undefined {
  const runCommand = async (name: string, argument: string): Promise<void> => {
    let message: string;
    try {
      message = await commands[name]!.run(argument, server.context as Record<string, unknown>);
    } catch (error) {
      message = `${name} failed: ${(error as Error).message}`;
    }
    output.write(`${message}\n`);
    server.displayPrompt();
  };
  for (const [name, command] of Object.entries(commands)) {
    server.defineCommand(name, {
      help: command.help,
      action(argument) {
        lines.enqueue(() => runCommand(name, argument));
      },
    });
  }
  return (line) => {
    const name = bangLine.exec(line)?.[1];
    return name !== undefined && commands[name]?.bang ? runCommand(name, "") : undefined;
  };
}

/** Starts the session; `closed` resolves when it ends (end of input, or `.exit`). */
export function startSession({
  input,
  output,
  terminal = false,
  historyFile,
  prompt = "> ",
  scope,
  commands = {},
  withDatabase,
  onLine,
}: SessionOptions): {
  closed: Promise<void>;
} {
  const lines = lineQueue();
  let written: { value: unknown } | undefined;
  const server = repl.start({
    prompt,
    input: terminal ? input : untilDrained(input, lines.pending),
    output,
    terminal,
    useColors: terminal,
    // Ctrl-C stops a running line, even an `await` that never finishes.
    breakEvalOnSigint: terminal,
    useGlobal: false,
    writer(this: repl.REPLServer, value: unknown) {
      if (onLine !== undefined) {
        written = { value };
        return "";
      }
      const shown = inspect(value, { colors: this.useColors });
      return types.isNativeError(value) ? shown : `#=> ${shown}`;
    },
  });
  if (terminal && historyFile !== undefined) server.setupHistory(historyFile, () => {});
  Object.assign(server.context, scope);
  const bang = defineCommands(server, commands, lines, output);
  const script = onLine && {
    report: onLine,
    written: () => written,
    reset: () => {
      written = undefined;
    },
  };
  lines.attach(server, withDatabase, bang, script);
  return {
    closed: new Promise((resolve) => server.on("exit", () => void lines.pending().then(resolve))),
  };
}
