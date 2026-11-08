// A generated migration's file name: a UTC timestamp, as Rails writes them, then its name.
import { underscore } from "../../src/naming.ts";

/** The leading number of a migration's path (`0009_x.sql`, `20261108090503_x/migration.sql`). */
function versionOf(path: string): number {
  return Number.parseInt(path.split("/")[0]!.split("_")[0]!, 10);
}

/** `20261108090503`: the UTC second, as 14 digits. */
function stamp(now: Date): number {
  return Number(now.toISOString().slice(0, 19).replaceAll(/\D/g, ""));
}

/**
 * The next migration's file name: the current UTC second as its version, or one past the highest
 * version there when that's later, as Rails numbers them, so two written in one second stay in
 * order. Files numbered `0001_…` sort before it, on every adapter.
 */
export function migrationFileName(existing: readonly string[], name: string, now: Date): string {
  const highest = Math.max(0, ...existing.map(versionOf).filter(Number.isFinite));
  const version = Math.max(stamp(now), highest + 1);
  return `${String(version).padStart(14, "0")}_${underscore(name)}.sql`;
}
