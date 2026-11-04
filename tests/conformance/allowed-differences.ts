// The behaviors an adapter may have its own way (ADR-0017), each with the conformance tests it skips there.
import type { AdapterName } from "../support/harness.ts";

/** A contract behavior one adapter keeps its database's own semantics for. */
export interface AllowedDifference {
  /** A short name for it, such as `"null-ordering"`. */
  id: string;
  /** The adapters it applies to. D1 sets the baseline, so it's never one of them. */
  adapters: readonly Exclude<AdapterName, "d1">[];
  /** Why the database differs, and what it does instead. */
  reason: string;
  /** The line of `docs/contract.md` it relaxes, quoted. */
  contract: string;
  /** The conformance tests it skips on those adapters, by full name (`"describe > test"`). */
  tests: readonly string[];
}

/** Empty until an adapter other than D1 needs one (#269). Each adapter's docs repeat the list. */
export const allowedDifferences: readonly AllowedDifference[] = [];

/** The allowed difference that skips the test named `name` on `adapter`, if one does. */
export function differenceSkipping(
  adapter: AdapterName,
  name: string,
  differences: readonly AllowedDifference[] = allowedDifferences,
): AllowedDifference | undefined {
  return differences.find(
    ({ adapters, tests }) =>
      (adapters as readonly AdapterName[]).includes(adapter) && tests.includes(name),
  );
}

/** A test's full name, as an allowed difference lists it: its describes and title, joined by " > ". */
export function fullName(task: { name: string; suite?: Suite | undefined }): string {
  const names = [task.name];
  for (let suite = task.suite; suite?.name; suite = suite.suite) names.unshift(suite.name);
  return names.join(" > ");
}

interface Suite {
  name: string;
  suite?: Suite | undefined;
}
