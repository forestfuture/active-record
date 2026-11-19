// Around callbacks (#48): `aroundSave`, `aroundCreate`, `aroundUpdate` and `aroundDestroy`, each wrapping the rest of its record's save or destroy, waiting at `next()` while the write's batch is sent.
import { runAfterCallbacks, runCallbacks } from "./callbacks.ts";
import { declared, type AroundCallbackKind } from "./declarations.ts";
import { abort, AbortAfterPersistence, CallbackAbort } from "./errors.ts";
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
  return started(gate, run);
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
  let inner: Promise<void> | undefined;
  const at = async (index: number): Promise<void> => {
    if (index === callbacks.length) {
      inner = inside();
      return inner;
    }
    try {
      await callbacks[index]!(
        record,
        nextOnce(kind, () => at(index + 1)),
      );
    } catch (error) {
      if (error instanceof CallbackAbort && gate.isOpen) {
        throw new AbortAfterPersistence(kind, lifecycleOf(kind), error);
      }
      throw error;
    }
  };
  await at(0);
  if (inner === undefined) throw abort(`An ${kind} callback didn't call next()`);
  await inner;
}

/** `next` for one around callback: runs `rest` the first time; `TypeError` after that. */
function nextOnce(kind: AroundCallbackKind, rest: () => Promise<void>): () => Promise<void> {
  let isCalled = false;
  return () => {
    if (isCalled) return Promise.reject(new TypeError(`${kind}: next() was already called`));
    isCalled = true;
    return rest();
  };
}

function lifecycleOf(kind: AroundCallbackKind): Lifecycle {
  return kind === "aroundDestroy" ? "destroy" : "save";
}

/** Waits until `run` reaches its write, or stops first: a `CallbackAbort` is returned, else thrown. */
async function started(gate: WriteGate, run: Promise<void>): Promise<Wrapped | CallbackAbort> {
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
