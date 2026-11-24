// Around callbacks (#48): `aroundSave`, `aroundCreate`, `aroundUpdate` and `aroundDestroy`, each wrapping the rest of its record's save or destroy, waiting at `next()` while the write's batch is sent.
import { runAfterCallbacks, runCallbacks } from "./callbacks.ts";
import { declared, type AroundCallback, type AroundCallbackKind } from "./declarations.ts";
import { abort, AbortAfterPersistence, CallbackAbort } from "./errors.ts";
import type { Claimed } from "./lifecycle.ts";
import { modelOf, type Model } from "./model.ts";

type Lifecycle = "save" | "destroy";

/**
 * Where a record's write waits while its around callbacks wait at `next()`: reached as the save
 * or destroy is prepared, then opened once the write is kept, or failed when it isn't.
 */
class WriteGate {
  readonly reached: Promise<void>;
  readonly #reach: () => void;
  readonly #outcome: Promise<void>;
  #settle!: { open: () => void; fail: (error: unknown) => void };
  #status: "pending" | "open" | "failed" = "pending";

  constructor() {
    let reach!: () => void;
    this.reached = new Promise((resolve) => (reach = resolve));
    this.#reach = reach;
    this.#outcome = new Promise((resolve, reject) => {
      this.#settle = { open: resolve, fail: reject };
    });
  }

  get isOpen(): boolean {
    return this.#status === "open";
  }

  get isWaiting(): boolean {
    return this.#status === "pending";
  }

  /** Marks the write reached, and waits for it to be kept (or refused). */
  wait(): Promise<void> {
    this.#reach();
    return this.#outcome;
  }

  open(): void {
    this.#status = "open";
    this.#settle.open();
  }

  fail(error: unknown): void {
    this.#status = "failed";
    this.#settle.fail(error);
  }
}

/**
 * A record's write, wrapped: its around callbacks have run their first parts and wait at
 * `next()` for it.
 */
export interface Wrapped {
  /** The write is kept: lets the callbacks finish, the inner after-callbacks with them. */
  finish(): Promise<void>;
  /**
   * The write was refused: `next()` rejects with `error`. Resolves once the callbacks have
   * settled, and throws one's error unless it's `error`, which the caller throws.
   */
  fail(error: unknown): Promise<void>;
  /**
   * The write was never sent, or its after-callbacks were skipped: if the callbacks still wait,
   * `next()` rejects with `error`, and this resolves once they've settled, whatever their outcome.
   */
  release(error: unknown): Promise<void>;
}

/** The around callbacks waiting at `next()` in each save or destroy, by its claimed records. */
const waiting = new WeakMap<object, Wrapped[]>();

/** Keeps `wrapped` with the save or destroy whose claimed records are `claimed`, to release. */
export function waitWith(claimed: object, wrapped: Wrapped): void {
  waiting.set(claimed, [...(waiting.get(claimed) ?? []), wrapped]);
}

/**
 * Runs `operation`, a save's or destroy's preparing and writing, handing it a new set for the
 * records it claims. When it ends, an around callback still waiting at `next()` (its write never
 * sent, or its after-callbacks skipped by an error) has `next()` reject with the error it threw,
 * or the one `refusal` gives for what it returned; then this waits for them, ignoring their
 * errors (#48).
 */
export async function withClaimedRecords<T>(
  operation: (claimed: Claimed) => Promise<T>,
  refusal: (result: T) => unknown = () => undefined,
): Promise<T> {
  const claimed: Claimed = new Set();
  let result: T;
  try {
    result = await operation(claimed);
  } catch (error) {
    await release(claimed, error);
    throw error;
  }
  const error = refusal(result);
  if (error !== undefined) await release(claimed, error);
  return result;
}

async function release(claimed: object, error: unknown): Promise<void> {
  for (const wrapped of waiting.get(claimed) ?? []) await wrapped.release(error);
}

/**
 * Starts a save's around callbacks: `aroundSave`, wrapping `beforeCreate` (or `beforeUpdate`), then
 * `aroundCreate` (or `aroundUpdate`), wrapping the write, then `afterCreate` (or `afterUpdate`).
 * Resolves once the write is reached, or to the `CallbackAbort` that stopped it.
 */
export function startSave(record: Model, isInsert: boolean): Promise<Wrapped | CallbackAbort> {
  const gate = new WriteGate();
  const run = around(record, "aroundSave", gate, async () => {
    await runCallbacks(record, isInsert ? "beforeCreate" : "beforeUpdate");
    await around(record, isInsert ? "aroundCreate" : "aroundUpdate", gate, () => gate.wait());
    await runAfterCallbacks(record, isInsert ? "afterCreate" : "afterUpdate", "save");
  });
  return untilWriteReached(gate, run);
}

/**
 * Starts a destroy's `aroundDestroy` callbacks, wrapping the write. Resolves once the write is
 * reached, or to the `CallbackAbort` that stopped it.
 */
export function startDestroy(record: Model): Promise<Wrapped | CallbackAbort> {
  const gate = new WriteGate();
  return untilWriteReached(
    gate,
    around(record, "aroundDestroy", gate, () => gate.wait()),
  );
}

/**
 * Runs `record`'s around callbacks of `kind` around `inside`, the first declared outermost, each
 * handed a `next` that runs the rest. One that doesn't call it stops the write, as `abort()` does.
 * Once the write is kept, an `abort()` in one is `AbortAfterPersistence`.
 */
async function around(
  record: Model,
  kind: AroundCallbackKind,
  gate: WriteGate,
  inside: () => Promise<void>,
): Promise<void> {
  const callbacks = declared(modelOf(record), kind);
  const runFrom = (index: number): Promise<void> => {
    if (index === callbacks.length) return inside();
    return runOne({ record, kind, gate }, callbacks[index]!, () => runFrom(index + 1));
  };
  await runFrom(0);
}

/** The record an around callback wraps the write of, its kind, and the write's gate. */
interface Wrapping {
  record: Model;
  kind: AroundCallbackKind;
  gate: WriteGate;
}

/**
 * Runs one around callback, its `next` running `rest`. One that doesn't call `next` stops the
 * write as `abort()` does, so the `next()` of a callback outside it rejects. What `next()` ran is
 * awaited once the callback returns, so the rest is finished, and a stop or refusal in it stands,
 * even when the callback didn't await it or caught its rejection (#48, decision 11). Once the
 * write is kept, an `abort()` in it is `AbortAfterPersistence`.
 */
async function runOne(
  { record, kind, gate }: Wrapping,
  callback: AroundCallback<Model>,
  rest: () => Promise<void>,
): Promise<void> {
  const next = nextOnce(kind, rest);
  try {
    await callback(record, next.call);
  } catch (error) {
    if (error instanceof CallbackAbort && gate.isOpen) {
      throw new AbortAfterPersistence(kind, lifecycleOf(kind), error);
    }
    throw error;
  }
  const rested = next.rested();
  if (rested === undefined) throw abort(`An ${kind} callback didn't call next()`);
  await rested;
}

/**
 * `next` for one around callback: runs `rest` the first time; `TypeError` after that. `rested` is
 * what the first call returned, or `undefined` before one.
 */
function nextOnce(
  kind: AroundCallbackKind,
  rest: () => Promise<void>,
): { call: () => Promise<void>; rested: () => Promise<void> | undefined } {
  let rested: Promise<void> | undefined;
  return {
    call: () => {
      if (rested !== undefined) {
        return Promise.reject(new TypeError(`${kind}: next() was already called`));
      }
      rested = rest();
      // Awaited by runOne once the callback returns; handled here until then.
      rested.catch(() => {});
      return rested;
    },
    rested: () => rested,
  };
}

function lifecycleOf(kind: AroundCallbackKind): Lifecycle {
  return kind === "aroundDestroy" ? "destroy" : "save";
}

/** Waits until `run` reaches its write, or stops first: a `CallbackAbort` is returned, else thrown. */
async function untilWriteReached(
  gate: WriteGate,
  run: Promise<void>,
): Promise<Wrapped | CallbackAbort> {
  const stopped = await Promise.race([
    gate.reached.then(() => undefined),
    run.then(
      () => undefined,
      (error: unknown) => ({ error }),
    ),
  ]);
  if (stopped !== undefined) {
    if (stopped.error instanceof CallbackAbort) return stopped.error;
    throw stopped.error;
  }
  // Its rejection is awaited later, once the write is sent; until then, it's handled here.
  run.catch(() => {});
  return {
    finish: async () => {
      gate.open();
      await run;
    },
    release: async (error) => {
      if (!gate.isWaiting) return;
      gate.fail(error);
      await run.catch(() => {});
    },
    fail: async (error) => {
      gate.fail(error);
      try {
        await run;
      } catch (thrown) {
        if (thrown !== error) throw thrown;
      }
    },
  };
}
