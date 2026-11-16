import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { Model } from "../../packages/active-record/src/index.ts";
import type { QueryEvent } from "../../packages/active-record/src/executor.ts";
import { openHarness, type Harness } from "../support/harness.ts";

class Review extends Model.define({
  id: { type: "integer", null: false },
  title: "string",
  rating: "integer",
  score: "real",
}) {
  static table = "typed_posts";
}

describe("calculations (#344)", () => {
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

  const seedReviews = async (...rows: [title: string, rating: number | null, score: number][]) => {
    for (const [title, rating, score] of rows) {
      await harness.exec("INSERT INTO typed_posts (title, rating, score) VALUES (?, ?, ?)", [
        title,
        rating,
        score,
      ]);
    }
  };

  describe("sum", () => {
    test("adds up an attribute's values over the rows, leaving out NULLs", async () => {
      await seedReviews(["a", 3, 1.5], ["b", 4, 2], ["c", null, 0.25]);

      expect(await reviews().sum("rating")).toBe(7);
      expect(await reviews().sum("score")).toBe(3.75);
    });

    test("is 0 with no rows", async () => {
      expect(await reviews().sum("rating")).toBe(0);
    });

    test("keeps the Relation's conditions", async () => {
      await seedReviews(["a", 3, 1], ["b", 4, 1], ["a", 5, 1]);

      expect(await reviews().where({ title: "a" }).sum("rating")).toBe(8);
    });

    test("after distinct(), adds up each distinct value once", async () => {
      await seedReviews(["a", 3, 1], ["b", 3, 1], ["c", 4, 1], ["d", null, 1]);

      expect(await reviews().distinct().sum("rating")).toBe(7);
    });

    test("with a limit or offset, adds up the rows they pick, in the Relation's order", async () => {
      await seedReviews(["a", 1, 1], ["b", 2, 1], ["c", 3, 1], ["d", 4, 1]);
      const byRating = reviews().order({ rating: "desc" });

      expect(await byRating.limit(2).sum("rating")).toBe(7);
      expect(await byRating.offset(1).limit(2).sum("rating")).toBe(5);
    });

    test("after distinct() with a limit, the limit picks from the distinct values", async () => {
      await seedReviews(["a", 5, 1], ["b", 5, 1], ["c", 4, 1], ["d", 3, 1]);

      expect(await reviews().distinct().order({ rating: "desc" }).limit(2).sum("rating")).toBe(9);
    });

    test("on none() is 0, with no query", async () => {
      await seedReviews(["a", 3, 1]);

      expect(await reviews().none().sum("rating")).toBe(0);
      expect(events).toEqual([]);
    });
  });

  describe("average", () => {
    test("is the mean of an attribute's values, leaving out NULLs, as a number", async () => {
      await seedReviews(["a", 3, 1.5], ["b", 4, 2], ["c", null, 0.25]);

      expect(await reviews().average("rating")).toBe(3.5);
      expect(await reviews().average("score")).toBe(1.25);
    });

    test("is null with no rows", async () => {
      expect(await reviews().average("rating")).toBeNull();
    });

    test("keeps the Relation's conditions", async () => {
      await seedReviews(["a", 3, 1], ["b", 4, 1], ["a", 6, 1]);

      expect(await reviews().where({ title: "a" }).average("rating")).toBe(4.5);
    });

    test("on none() is null, with no query", async () => {
      await seedReviews(["a", 3, 1]);

      expect(await reviews().none().average("rating")).toBeNull();
      expect(events).toEqual([]);
    });
  });
});
