// The override that reads a Unix time column as a `Date`, as notes print it.
import { type EpochStorage, epochStorages } from "../../src/epoch-storage.ts";

/** Drizzle's `mode` for each epoch storage, which a note names for a reader with its schema open. */
const drizzleModes: Record<EpochStorage, string> = {
  unixSeconds: '"timestamp"',
  unixMilliseconds: '"timestamp_ms"',
};

/** The override that reads a Unix time as a `Date`, for a note; with Drizzle's modes named if asked. */
export function storageOverride(withDrizzleModes: boolean): string {
  const storages = epochStorages.map((storage) =>
    withDrizzleModes ? `"${storage}" (${drizzleModes[storage]})` : `"${storage}"`,
  );
  return `{ type: "datetime", storage: ${storages.join(" or ")} }`;
}
