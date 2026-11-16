import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { defineType, Model } from "../../packages/active-record/src/index.ts";
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

class Post extends Model.define({
  id: { type: "integer", null: false },
  publishedAt: "datetime",
}) {
  static table = "typed_posts";
}

class Line extends Model.define({
  id: { type: "integer", null: false },
  amount: "decimal",
  bookedOn: "date",
  startsAt: "time",
}) {
  static table = "ledger_lines";
}

/** An amount of money, kept as integer cents. */
class Money {
  readonly cents: number;
  constructor(cents: number) {
    this.cents = cents;
  }
}

const money = defineType({
  storedAs: "integer",
  cast(input) {
    if (input instanceof Money) return input;
    throw new TypeError("not an amount of money");
  },
  serialize: (value) => value.cents,
  deserialize: (cents) => new Money(cents),
});

class Listing extends Model.define({
  id: { type: "integer", null: false },
  price: money,
}) {
  static table = "listings";
}

class Article extends Model.define({
  id: { type: "integer", null: false },
  status: { type: "string", enum: ["draft", "published"] },
  priority: { type: "integer", enum: { low: 0, normal: 5, high: 10 } },
}) {}

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
    await harness.reset("typed_posts", "ledger_lines", "listings", "articles");
  });
  const db = () => harness.connect();

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

  describe("minimum and maximum", () => {
    test("are the least and greatest of an attribute's values, leaving out NULLs", async () => {
      await seedReviews(["a", 3, 1.5], ["b", 4, 2], ["c", null, 0.25]);

      expect(await reviews().minimum("rating")).toBe(3);
      expect(await reviews().maximum("rating")).toBe(4);
      expect(await reviews().minimum("title")).toBe("a");
      expect(await reviews().maximum("score")).toBe(2);
    });

    test("are null with no rows", async () => {
      expect(await reviews().minimum("rating")).toBeNull();
      expect(await reviews().maximum("rating")).toBeNull();
    });

    test("keep the Relation's conditions", async () => {
      await seedReviews(["a", 3, 1], ["b", 1, 1], ["a", 6, 1]);

      expect(await reviews().where({ title: "a" }).minimum("rating")).toBe(3);
      expect(await reviews().where({ title: "b" }).maximum("rating")).toBe(1);
    });

    test("on none() are null, with no query", async () => {
      await seedReviews(["a", 3, 1]);

      expect(await reviews().none().minimum("rating")).toBeNull();
      expect(await reviews().none().maximum("rating")).toBeNull();
      expect(events).toEqual([]);
    });

    test("with a limit, are of the rows it picks", async () => {
      await seedReviews(["a", 1, 1], ["b", 2, 1], ["c", 3, 1]);

      expect(await reviews().order({ rating: "desc" }).limit(2).minimum("rating")).toBe(2);
    });
  });

  describe("values read as the attribute's own", () => {
    test("a datetime's extremes are Dates", async () => {
      const days = [new Date("2026-01-02T00:00:00.000Z"), new Date("2026-03-04T05:06:07.000Z")];
      for (const publishedAt of days) await db().model(Post).create({ publishedAt });

      expect(await db().model(Post).minimum("publishedAt")).toEqual(days[0]);
      expect(await db().model(Post).maximum("publishedAt")).toEqual(days[1]);
    });

    test('a decimal sums exactly, as its text, and is "0" with no rows', async () => {
      expect(await db().model(Line).sum("amount")).toBe("0");
      for (const amount of ["0.1", "0.2", "12.50"]) await db().model(Line).create({ amount });

      expect(await db().model(Line).sum("amount")).toBe("12.8");
      expect(await db().model(Line).maximum("amount")).toBe("12.5");
    });

    test("a date's and a time's extremes are their text", async () => {
      await db().model(Line).create({ bookedOn: "2026-01-02", startsAt: "09:30" });
      await db().model(Line).create({ bookedOn: "2025-12-31", startsAt: "17:00:00.25" });

      expect(await db().model(Line).minimum("bookedOn")).toBe("2025-12-31");
      expect(await db().model(Line).maximum("startsAt")).toBe("17:00:00.25");
    });

    test("a custom type's sum and extremes are its values", async () => {
      for (const cents of [250, 100])
        await db()
          .model(Listing)
          .create({ price: new Money(cents) });

      expect(await db().model(Listing).sum("price")).toEqual(new Money(350));
      expect(await db().model(Listing).minimum("price")).toEqual(new Money(100));
      expect(await db().model(Listing).none().sum("price")).toEqual(new Money(0));
    });

    test("an enum's extremes are by its stored value, read as its name", async () => {
      await db().model(Article).create({ status: "published", priority: "high" });
      await db().model(Article).create({ status: "draft", priority: "normal" });

      expect(await db().model(Article).minimum("status")).toBe("draft");
      expect(await db().model(Article).maximum("priority")).toBe("high");
      expect(await db().model(Article).minimum("priority")).toBe("normal");
    });
  });
});
