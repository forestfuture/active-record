import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { column, Model, sql, withDatabase } from "../../packages/active-record/src/index.ts";
import type { QueryEvent } from "../../packages/active-record/src/executor.ts";
import { openHarness, type Harness } from "../support/harness.ts";

class Review extends Model.define({
  id: { type: "integer", null: false },
  title: "string",
  featured: "boolean",
  rating: "integer",
  score: "real",
  publishedAt: "datetime",
}) {
  static table = "typed_posts";
}

describe("group (#345)", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());

  const events: QueryEvent[] = [];
  const reviews = () => harness.connect({ onQuery: (event) => events.push(event) }).model(Review);
  beforeEach(async () => {
    events.length = 0;
    await harness.reset("typed_posts");
  });

  const seed = async (...rows: [title: string | null, rating: number | null][]) => {
    for (const [title, rating] of rows) {
      await harness.exec("INSERT INTO typed_posts (title, rating) VALUES (?, ?)", [title, rating]);
    }
  };

  describe("count", () => {
    test("counts each group's rows, keyed by its value, a null group included", async () => {
      await seed(["a", 1], ["b", 2], ["a", 3], [null, 4]);

      expect(await reviews().group("title").count()).toEqual(
        new Map([
          ["a", 2],
          ["b", 1],
          [null, 1],
        ]),
      );
    });

    test("by two attributes, keys each group by a tuple of their values", async () => {
      await seed(["a", 1], ["a", 1], ["a", 2], [null, null]);

      expect(await reviews().group("title", "rating").count()).toEqual(
        new Map<[string | null, number | null], number>([
          [["a", 1], 2],
          [["a", 2], 1],
          [[null, null], 1],
        ]),
      );
    });

    test("of an attribute, counts each group's non-null values", async () => {
      await seed(["a", 1], ["a", null], ["b", null]);

      expect(await reviews().group("title").count("rating")).toEqual(
        new Map([
          ["a", 1],
          ["b", 0],
        ]),
      );
    });

    test("a Model's static groups on the current database", async () => {
      await seed(["a", 1], ["a", 2]);

      const counts = await withDatabase(harness.connect(), () => Review.group("title").count());

      expect(counts).toEqual(new Map([["a", 2]]));
    });
  });

  describe("sum, average, minimum and maximum", () => {
    test("calculate each group's values, leaving out NULLs", async () => {
      await seed(["a", 1], ["a", 4], ["b", 2], ["b", null], ["c", null]);
      const byTitle = reviews().group("title");

      expect(await byTitle.sum("rating")).toEqual(
        new Map([
          ["a", 5],
          ["b", 2],
          ["c", 0],
        ]),
      );
      expect(await byTitle.average("rating")).toEqual(
        new Map([
          ["a", 2.5],
          ["b", 2],
          ["c", null],
        ]),
      );
      expect(await byTitle.minimum("rating")).toEqual(
        new Map([
          ["a", 1],
          ["b", 2],
          ["c", null],
        ]),
      );
      expect(await byTitle.maximum("rating")).toEqual(
        new Map([
          ["a", 4],
          ["b", 2],
          ["c", null],
        ]),
      );
    });

    test("read as the attribute's value, so a datetime's extreme is a Date", async () => {
      for (const [title, publishedAt] of [
        ["a", "2026-01-02T00:00:00.000Z"],
        ["a", "2026-03-04T00:00:00.000Z"],
      ]) {
        await harness
          .connect()
          .model(Review)
          .create({ title, publishedAt: new Date(publishedAt!) });
      }

      expect(await reviews().group("title").maximum("publishedAt")).toEqual(
        new Map([["a", new Date("2026-03-04T00:00:00.000Z")]]),
      );
    });

    test("of an sql fragment, calculate its expression in each group", async () => {
      await seed(["a", 1], ["a", 4], ["b", 2]);

      expect(
        await reviews()
          .group("title")
          .sum(sql`${column("rating")} * 10`),
      ).toEqual(
        new Map([
          ["a", 50],
          ["b", 20],
        ]),
      );
    });

    test("calculate() runs the one its operation names", async () => {
      await seed(["a", 1], ["a", 4], ["b", 2]);
      const byTitle = reviews().group("title");

      expect(await byTitle.calculate("sum", "rating")).toEqual(
        new Map([
          ["a", 5],
          ["b", 2],
        ]),
      );
      expect(await byTitle.calculate("count")).toEqual(
        new Map([
          ["a", 2],
          ["b", 1],
        ]),
      );
    });
  });

  describe("after distinct()", () => {
    test("counts and sums each group's distinct values once", async () => {
      await seed(["a", 1], ["a", 1], ["a", 2], ["b", null]);
      const distinct = reviews().distinct().group("title");

      expect(await distinct.count("rating")).toEqual(
        new Map([
          ["a", 2],
          ["b", 0],
        ]),
      );
      expect(await distinct.sum("rating")).toEqual(
        new Map([
          ["a", 3],
          ["b", 0],
        ]),
      );
      expect(await distinct.average("rating")).toEqual(
        new Map([
          ["a", 1.5],
          ["b", null],
        ]),
      );
    });

    test("count() still counts each group's rows", async () => {
      await seed(["a", 1], ["a", 1]);

      expect(await reviews().distinct().group("title").count()).toEqual(new Map([["a", 2]]));
    });
  });
});
