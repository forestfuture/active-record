// Holding a statement open until released, to land a read or write in a chosen order, on any adapter.
import type { AnyDatabase } from "../../packages/active-record/src/database.ts";
import type { Driver } from "../../packages/active-record/src/driver.ts";
import type { Harness } from "./harness.ts";

/** Whether a statement reads `table`: what to hold to land a read after something else. */
export const reads = (table: string) => (sql: string) =>
  sql.startsWith("SELECT") && sql.includes(`"${table}"`);

/** A held statement waits for `release()` before it reaches the database, or after it has answered. */
type Hold = "beforeRunning" | "afterRunning";

/**
 * A Database that, once armed, holds each statement sent on its own whose SQL `matches` until
 * released: ordered, not timed, so whatever runs meanwhile always lands first. `held` resolves
 * when one is held.
 */
export function holdStatements(
  harness: Harness,
  matches: (sql: string) => boolean,
  hold: Hold,
): { db: AnyDatabase; arm: () => void; held: Promise<void>; release: () => void } {
  let armed = false;
  let isHeld!: () => void;
  let release!: () => void;
  const held = new Promise<void>((resolve) => (isHeld = resolve));
  const released = new Promise<void>((resolve) => (release = resolve));
  const holding = (driver: Driver): Driver => ({
    read: (statements) => driver.read(statements),
    write: (statements) => driver.write(statements),
    recover: (error) => driver.recover(error),
    async send(statement) {
      if (!armed || !matches(statement.sql)) return driver.send(statement);
      const result = hold === "afterRunning" ? await driver.send(statement) : undefined;
      isHeld();
      await released;
      return result ?? driver.send(statement);
    },
  });
  return { db: harness.connect({ driver: holding }), arm: () => (armed = true), held, release };
}
