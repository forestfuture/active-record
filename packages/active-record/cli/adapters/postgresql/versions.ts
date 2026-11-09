// Each migration's version, the number its name starts with, which the runner records: as a number, so `01_…` and `1_…` share one.
import { byVersion } from "@forestfuture/active-record/cli";

/**
 * Each migration's version, by its file, in the order they're applied; or why one has none, or
 * shares its version with another, which `migrate` and the schema both refuse.
 */
export function versionsOf(files: readonly string[]): Map<string, string> | string {
  const versions = new Map<string, string>();
  const seen = new Map<string, string>();
  for (const file of [...files].sort(byVersion)) {
    const digits = /^(\d+)/.exec(file)?.[1];
    if (digits === undefined) {
      return `${file} has no version: start its name with one, as the generators do (20261108090503_create_products.sql)`;
    }
    const version = BigInt(digits).toString();
    const other = seen.get(version);
    if (other !== undefined) {
      return `${other} and ${file} have the same version, ${version}; give one a version of its own`;
    }
    seen.set(version, file);
    versions.set(file, version);
  }
  return versions;
}
