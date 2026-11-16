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

    test("on none() is 0, with no query", async () => {
      await seedReviews(["a", 3, 1]);

      expect(await reviews().none().sum("rating")).toBe(0);
      expect(events).toEqual([]);
    });
  });
});
