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
  /**
   * The conformance tests that run on those adapters by avoiding it, by full name: a property
   * test that leaves it out of what it generates (through `allows`), or one whose schema there
   * doesn't reach it.
   */
  avoidedBy?: readonly string[];
}

const ordering = '`order({ createdAt: "desc", id: "asc" })` sorts by each key in turn';

/** Each adapter's docs repeat the list. */
export const allowedDifferences: readonly AllowedDifference[] = [
  {
    id: "null-ordering",
    adapters: ["pg"],
    reason:
      "Postgres sorts NULL after every value: last in ascending order and first in descending " +
      "order, where SQLite sorts it first in ascending order. Placed with `nulls`, NULLs sort " +
      "the same on both.",
    contract: "NULLs sort first in ascending order, as SQLite sorts them, unless placed",
    tests: [
      "conditions > distinct removes duplicate rows, and count counts distinct values",
      "ordering extras > order takes an sql fragment for expressions, and appends like any order",
      "ordering extras > a fragment order's values bind in place, alongside where and limit values, in count too",
    ],
  },
  {
    id: "text-collation",
    adapters: ["pg"],
    reason:
      "Postgres sorts text by the database's collation, usually its locale's, where capitals " +
      "and lowercase letters interleave. SQLite sorts by code point, so every capital comes " +
      "before every lowercase letter.",
    contract: ordering,
    tests: [
      "ordering extras > merging a reorder() replaces the order, even with nothing, as in Rails",
    ],
  },
  {
    id: "distinct-order",
    adapters: ["pg"],
    reason:
      "Postgres refuses to order a `distinct()` query by a column it doesn't select, with its " +
      "own error. SQLite orders by it.",
    contract: ordering,
    tests: [],
    avoidedBy: ["exists(), for any Relation > is whether toArray() returns any record"],
  },
  {
    id: "nul-in-text",
    adapters: ["pg"],
    reason:
      "Postgres text can't hold the NUL character (U+0000), so a value with one is refused " +
      "with Postgres's own error. SQLite stores it.",
    contract: "Values are never inlined (ADR-0006)",
    tests: [],
    avoidedBy: [
      "a text value of any content, in a query > is bound: the statement is the same, and the rows are those an exact match gives",
      "a text value of any content, in a query > is bound when interpolated into an sql fragment",
      "a text value of any content, in a query > is bound in a list of values: the statement is the same, and each exact match is found",
      "a text value of any content, in a query > is stored and read back as it was",
      "a text value of any content, in a query > is inserted with the statement a harmless value gives",
    ],
  },
  {
    id: "identity-keys",
    adapters: ["pg"],
    reason:
      "A key written by hand doesn't move a Postgres identity, so the next key it makes can " +
      "be one already taken. SQLite's next key is always past the largest.",
    contract: "which is the primary key by default",
    tests: [
      "statements > insertAll, and skipping or updating duplicates > upsert matches on the primary key by default, even when it isn't given",
    ],
  },
  {
    id: "constraint-tables",
    adapters: ["pg"],
    reason:
      "Postgres's constraint errors name their table and columns, so a batch's foreign-key " +
      "failure has them too, where D1's names neither.",
    contract: "A batch that writes to several then has `.table` `null`",
    tests: ["statements > db.batch > …and no table when the batch writes to several"],
  },
  {
    id: "jsonb-text",
    adapters: ["pg"],
    reason:
      "A jsonb column keeps a JSON value, not its text: a raw query reads it back with " +
      "Postgres's own spacing and key order. The value the library reads is the same. A json " +
      "or text column keeps the text as written.",
    contract: "`Model.typeForAttribute(name)` (#148) gives an attribute's conversions",
    tests: [],
    avoidedBy: [
      "typeForAttribute against the database: a raw statement and a save agree (#148) > serialize gives what a save writes, for every type",
    ],
  },
];

/** Whether `adapter` keeps its database's own semantics for the difference named `id`. */
export function allows(adapter: AdapterName, id: string): boolean {
  return allowedDifferences.some(
    (difference) =>
      difference.id === id && (difference.adapters as readonly AdapterName[]).includes(adapter),
  );
}

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
