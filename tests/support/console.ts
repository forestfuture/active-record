import { PassThrough } from "node:stream";
import { startSession, type SessionOptions } from "../../packages/d1-record/cli/console/session.ts";

/** Polls until `done` is true; throws, naming what it waited for, after about `seconds`. */
export async function waitFor(done: () => boolean, seconds = 10): Promise<void> {
  for (let waited = 0; !done(); waited++) {
    if (waited >= seconds * 20) throw new Error(`Waited ${seconds} s for ${done.toString()}`);
    await new Promise((resolve) => setTimeout(resolve, 50));
  }
}

/** A console's two ends, as a person at a terminal would use them. */
export function terminalStreams() {
  const input = new PassThrough();
  const output = new PassThrough();
  let printed = "";
  let transcript = "";
  const waiting: (() => void)[] = [];
  output.on("data", (chunk: Buffer) => {
    printed += chunk.toString();
    transcript += chunk.toString();
    if (printed.endsWith("> ")) for (const wake of waiting.splice(0)) wake();
  });
  const ready = () =>
    new Promise<void>((resolve) => {
      if (printed.endsWith("> ")) resolve();
      else waiting.push(resolve);
    });
  return {
    input,
    output,
    /** Resolves when the console asks for a line, then forgets what it printed so far. */
    async ready(): Promise<void> {
      await ready();
      printed = "";
      transcript = "";
    },
    /** Everything printed since `ready`, prompts included. */
    transcript: () => transcript,
    /** Types a line; resolves with what the console printed before it asked for the next one. */
    async send(line: string): Promise<string> {
      printed = "";
      input.write(`${line}\n`);
      await ready();
      return printed.replace(/(?:^|\n)(?:local|remote)?> $/, "").trim();
    },
  };
}

/** Drives a console session started directly on these options. */
export async function drive(options: Omit<SessionOptions, "input" | "output">) {
  const terminal = terminalStreams();
  const session = startSession({ ...options, input: terminal.input, output: terminal.output });
  await terminal.ready();
  return {
    send: (line: string) => terminal.send(line),
    async close(): Promise<void> {
      terminal.input.end();
      await session.closed;
    },
  };
}

/** A script's three streams, as `-e` writes to them: what each has been given, as text. */
export function capturedStreams() {
  const input = new PassThrough();
  const output = new PassThrough();
  const error = new PassThrough();
  const seen = { stdout: "", stderr: "" };
  output.on("data", (chunk: Buffer) => (seen.stdout += chunk.toString()));
  error.on("data", (chunk: Buffer) => (seen.stderr += chunk.toString()));
  return { input, output, error, seen };
}
