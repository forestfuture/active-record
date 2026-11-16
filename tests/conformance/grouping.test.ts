import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { Model, withDatabase } from "../../packages/active-record/src/index.ts";
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

    test("a Model's static groups on the current database", async () => {
      await seed(["a", 1], ["a", 2]);

      const counts = await withDatabase(harness.connect(), () => Review.group("title").count());

      expect(counts).toEqual(new Map([["a", 2]]));
    });
  });
});
