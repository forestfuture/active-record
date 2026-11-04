import { describe, expect, test } from "vite-plus/test";
import {
  type AllowedDifference,
  allowedDifferences,
  differenceSkipping,
  fullName,
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

  test("none names D1, which sets the baseline, and each is complete with a unique id", () => {
    const ids = allowedDifferences.map(({ id }) => id);

    expect(allowedDifferences.filter(({ adapters }) => adapters.includes("d1" as never))).toEqual(
      [],
    );
    expect(new Set(ids).size).toBe(ids.length);
    for (const difference of allowedDifferences) {
      expect([difference.reason, difference.contract, ...difference.tests]).not.toContain("");
      expect(difference.tests.length).toBeGreaterThan(0);
    }
  });

  test("a test's full name joins its describes and title", () => {
    const suite = { name: "ordering", suite: { name: "" } };

    expect(fullName({ name: "puts nulls first", suite })).toBe("ordering > puts nulls first");
  });
});
