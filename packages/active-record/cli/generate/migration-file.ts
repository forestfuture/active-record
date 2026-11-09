// A generated migration's file name: a UTC timestamp, as Rails writes them, then its name.
import { underscore } from "../../src/naming.ts";
import { leadingNumber } from "../project/migrations.ts";

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
  const highest = Math.max(0, ...existing.map(leadingNumber).filter(Number.isFinite));
  const version = Math.max(stamp(now), highest + 1);
  return `${String(version).padStart(14, "0")}_${underscore(name)}.sql`;
}
