// Refusing a promise from code that runs synchronously: load callbacks, `build`'s `init`, a normalization, a batch's callback.

/**
 * Throws `TypeError` with `message` if `result` is a promise or another thenable, which the code
 * that ran it can't await. Its rejection, if it has one, is handled here, so the `TypeError` is
 * the only error.
 */
export function refuseThenable(result: unknown, message: string): void {
  if (!isThenable(result)) return;
  void Promise.resolve(result).catch(() => {});
  throw new TypeError(message);
}

/** Whether `value` is a Promise or another thenable, as an async function returns. */
export function isThenable(value: unknown): value is PromiseLike<unknown> {
  return typeof (value as { then?: unknown } | null)?.then === "function";
}
