import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { Post } from "../fixtures/models/post.ts";
import { openHarness, providedAdapter, type Harness } from "../support/harness.ts";
import { SLOW_RUNS, SLOW_TIMEOUT } from "../support/properties.ts";
import { allows } from "./allowed-differences.ts";

const JAN = "2026-01-01T00:00:00.000Z";
const FEB = "2026-02-01T00:00:00.000Z";

/** Repeated titles and dates, and some posts without a date, so distinct() and NULL matter. */
const POSTS = [
  [1, "A", 1, JAN],
  [2, "B", 0, null],
  [3, "B", 0, FEB],
  [4, "C", 1, JAN],
  [5, "A", 0, null],
  [6, "B", 1, FEB],
  [7, "C", 1, null],
  [8, "A", 0, JAN],
] as const;

const attributes = ["title", "createdAt"] as const;
const selections = [undefined, ["title"], ["published"], ["title", "published"]] as const;
const conditions = [undefined, { published: true }, { title: "B" }, { title: ["A", "C"] }] as const;
const orders = [
  undefined,
  { title: "asc" },
  { createdAt: { direction: "asc", nulls: "first" } },
  { id: "desc" },
] as const;

// count(attribute) counts the non-null values pluck(attribute) returns: whatever the Relation,
// its distinct(), order, limit and offset included, they agree (#250).
describe("count(attribute), for any Relation", { timeout: SLOW_TIMEOUT }, () => {
  let harness: Harness;
  const posts = () => harness.connect().model(Post);

  beforeAll(async () => {
    harness = await openHarness();
    await harness.exec("INSERT INTO users (id, email) VALUES (1, 'a@example.com')");
    for (const [id, title, published, createdAt] of POSTS) {
      await harness.exec(
        "INSERT INTO posts (id, user_id, title, published, created_at) VALUES (?, 1, ?, ?, ?)",
        [id, title, published, createdAt],
      );
    }
  });
  afterAll(() => harness.dispose());

  const relations = fc
    .record({
      attribute: fc.constantFrom(...attributes),
      select: fc.constantFrom(...selections),
      distinct: fc.boolean(),
      where: fc.constantFrom(...conditions),
      order: fc.constantFrom(...orders),
      limit: fc.option(fc.nat({ max: 10 }), { nil: undefined }),
      offset: fc.option(fc.nat({ max: 10 }), { nil: undefined }),
    })
    .filter((relation) => orderable(relation));

  /**
   * Whether the database orders it: Postgres won't order distinct values by another column.
   * Both count(attribute) and pluck(attribute) select only the attribute.
   */
  function orderable({
    attribute,
    distinct,
    order,
  }: {
    attribute: string;
    distinct: boolean;
    order?: object;
  }) {
    if (!distinct || order === undefined) return true;
    if (!allows(providedAdapter(), "distinct-order")) return true;
    return Object.keys(order).every((key) => key === attribute);
  }

  test("is how many non-null values pluck(attribute) returns", async () => {
    await fc.assert(
      fc.asyncProperty(
        relations,
        async ({ attribute, select, distinct, where, order, limit, offset }) => {
          let relation = posts();
          if (select !== undefined) relation = relation.select(...select);
          if (distinct) relation = relation.distinct();
          if (where !== undefined) relation = relation.where(where);
          if (order !== undefined) relation = relation.order(order);
          // Rows that tie on the order are ordered by id, so a limit picks the same rows for both.
          if (order !== undefined && !distinct) relation = relation.order({ id: "asc" });
          if (limit !== undefined) relation = relation.limit(limit);
          if (offset !== undefined) relation = relation.offset(offset);

          const values = await relation.pluck(attribute);
          expect(await relation.count(attribute)).toBe(values.filter((v) => v !== null).length);
        },
      ),
      SLOW_RUNS,
    );
  });
});
