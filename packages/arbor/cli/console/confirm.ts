// Asking which remote database a person means, before the console opens it (#104).
import { createInterface } from "node:readline";
import type { Readable, Writable } from "node:stream";
import type { RemoteTarget } from "../adapter.ts";

/** The answer, and how to stop dropping what is typed behind it. */
export interface Confirmation {
  confirmed: boolean;
  /**
   * Stops dropping input, which the console calls once the database is open and the session is
   * about to read lines. Until then everything typed or pasted behind the answer is discarded:
   * a terminal hands a pasted block over one line at a time, so the lines after the answer would
   * otherwise wait for the session and then run on the real database.
   */
  release: () => Promise<void>;
}

/** How long input must stay quiet, once released, for what was already on its way to have arrived. */
const QUIET_MS = 50;

/** Reads and drops everything on `input` until the returned function is called and it is quiet. */
function discarding(input: Readable): () => Promise<void> {
  const drop = () => {};
  input.on("data", drop);
  input.resume();
  return async () => {
    await new Promise((resolve) => setTimeout(resolve, QUIET_MS));
    input.off("data", drop);
    input.pause();
  };
}

/**
 * Names the remote database and asks for its name; confirmed only when that is what is typed.
 * Anything else, a blank line, or the end of the input cancels. It reads one line, and then
 * drops what follows (see `Confirmation.release`).
 */
export async function confirmRemote({
  input,
  output,
  target,
  consequence = "What you change in the console is changed in this database, not a copy.",
}: {
  input: Readable;
  output: Writable;
  target: RemoteTarget;
  /** What going ahead does to the database, for the person to read before typing its name. */
  consequence?: string;
}): Promise<Confirmation> {
  const note = target.note === undefined ? "" : `${target.note}\n`;
  output.write(
    `${target.description}\n${note}${consequence}\n` +
      "Type its name to continue, anything else cancels: ",
  );
  const reader = createInterface({ input, terminal: false });
  // The end of the input is no answer at all, which is not the same as a blank one.
  const typed = await new Promise<string | undefined>((resolve) => {
    reader.once("line", resolve);
    reader.once("close", () => resolve(undefined));
  });
  reader.close();
  const release = discarding(input);
  const confirmed = typed !== undefined && target.name !== "" && typed.trim() === target.name;
  return { confirmed, release };
}
