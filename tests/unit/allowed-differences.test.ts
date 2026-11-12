import { describe, expect, test } from "vite-plus/test";
import {
  type AllowedDifference,
  allowedDifferences,
  differenceSkipping,
  fullName,
  unknownTests,
} from "../conformance/allowed-differences.ts";

// A second adapter, as #269 adds one, so a difference can name it.
const nullOrdering = {
  id: "null-ordering",
  adapters: ["pg"],
  reason: "Postgres sorts NULL last in ascending order.",
  contract: "NULLs sort first in ascending order.",
  tests: ["ordering > puts nulls first"],
} as unknown as AllowedDifference;

describe("allowed differences", () => {
  test("a difference skips the tests it names, on its adapters only", () => {
    const differences = [nullOrdering];

    expect(differenceSkipping("pg" as never, "ordering > puts nulls first", differences)).toBe(
      nullOrdering,
    );
    expect(differenceSkipping("d1", "ordering > puts nulls first", differences)).toBeUndefined();
    expect(differenceSkipping("pg" as never, "ordering > by name", differences)).toBeUndefined();
  });

  test("none names D1, which sets the baseline, and each is complete with a unique id and its tests", () => {
    const ids = allowedDifferences.map(({ id }) => id);

    expect(allowedDifferences.filter(({ adapters }) => adapters.includes("d1" as never))).toEqual(
      [],
    );
    expect(new Set(ids).size).toBe(ids.length);
    for (const difference of allowedDifferences) {
      const named = [...difference.tests, ...(difference.avoidedBy ?? [])];
      expect([difference.reason, difference.contract, ...named]).not.toContain("");
      expect(named.length).toBeGreaterThan(0);
    }
  });

  test("a test's full name joins its describes and title", () => {
    const suite = { name: "ordering", suite: { name: "" } };

    expect(fullName({ name: "puts nulls first", suite })).toBe("ordering > puts nulls first");
  });

  test("unknownTests names each difference and each test it lists that no test has", () => {
    const stale = {
      ...nullOrdering,
      avoidedBy: ["ordering > by name", "ordering > renamed long ago"],
    } as unknown as AllowedDifference;

    expect(
      unknownTests([nullOrdering, stale], ["ordering > puts nulls first", "ordering > by name"]),
    ).toEqual([{ difference: "null-ordering", test: "ordering > renamed long ago" }]);
  });
});
