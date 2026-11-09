import { describe, expect, test } from "vite-plus/test";
import { byVersion } from "../../packages/active-record/cli/project/migrations.ts";

const ordered = (...paths: string[]) => [...paths].sort(byVersion);

// Migrations apply in the order Wrangler applies D1's, on every adapter (#285).
describe("the order migrations apply in", () => {
  test("is their leading numbers' order, as numbers, with unnumbered files after them", () => {
    expect(ordered("10_b.sql", "notes.sql", "9_a.sql", "20261108090503_c.sql")).toEqual([
      "9_a.sql",
      "10_b.sql",
      "20261108090503_c.sql",
      "notes.sql",
    ]);
  });

  test("compares a path folder by folder, as Wrangler does", () => {
    expect(ordered("v1/10_b.sql", "v2/1_c.sql", "v1/2_a.sql")).toEqual([
      "v1/2_a.sql",
      "v1/10_b.sql",
      "v2/1_c.sql",
    ]);
  });
});
