import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  column,
  defineType,
  Model,
  sql,
  UnknownAttribute,
} from "../../packages/active-record/src/index.ts";
import { User } from "../fixtures/models/user.ts";
import { withDatabase } from "../../packages/active-record/src/index.ts";
import type { QueryEvent } from "../../packages/active-record/src/executor.ts";
import { openHarness, type Harness } from "../support/harness.ts";

/** A name the types don't allow, as one from a request would arrive. */
const untyped = (value: unknown) => value as never;

class Review extends Model.define({
  id: { type: "integer", null: false },
  title: "string",
  featured: "boolean",
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

class Reading extends Model.define({
  id: { type: "integer", null: false },
  value: "integer",
  price: "integer",
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
    await harness.reset("typed_posts", "ledger_lines", "listings", "articles", "readings");
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

    test("with a limit, the order picks rows by its own column, even one named value", async () => {
      for (const [value, price] of [
        [1, 100],
        [2, 10],
        [3, 50],
      ]) {
        await db().model(Reading).create({ value, price });
      }
      const readings = db().model(Reading);

      expect(await readings.order({ value: "asc" }).limit(2).sum("price")).toBe(110);
      expect(
        await readings
          .order(sql`${column("value")} DESC`)
          .limit(1)
          .maximum("price"),
      ).toBe(50);
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

  describe("of an sql fragment", () => {
    test("sum and average are numbers, with its values bound", async () => {
      await seedReviews(["a", 3, 1.5], ["b", 4, 2], ["c", null, 0.25]);
      const doubled = sql`${column("rating")} * ${2}`;

      expect(await reviews().sum(doubled)).toBe(14);
      expect(await reviews().average(doubled)).toBe(7);
      expect(await reviews().where({ title: "c" }).sum(doubled)).toBe(0);
      expect(events.at(-1)?.params).toEqual([2, "c"]);
    });

    test("minimum and maximum are the values the database returns, or null with none", async () => {
      await seedReviews(["ab", 3, 1], ["abcd", 4, 1]);
      const length = sql`length(${column("title")})`;

      expect(await reviews().minimum(length)).toBe(2);
      expect(await reviews().maximum(length)).toBe(4);
      expect(await reviews().none().maximum(length)).toBeNull();
    });
  });

  describe("refusals, before any query", () => {
    test("an attribute the Model doesn't have rejects with UnknownAttribute, even on none()", async () => {
      for (const relation of [reviews(), reviews().none()]) {
        await expect(relation.sum(untyped("missing"))).rejects.toThrow(UnknownAttribute);
        await expect(relation.maximum(untyped("missing"))).rejects.toThrow(UnknownAttribute);
        await expect(relation.sum(sql`${column(untyped("missing"))}`)).rejects.toThrow(
          UnknownAttribute,
        );
      }
      expect(events).toEqual([]);
    });

    test("sum and average take only number attributes", async () => {
      await expect(reviews().sum(untyped("title"))).rejects.toThrow(
        'sum() needs a number attribute: "title" is a string attribute',
      );
      await expect(db().model(Article).average(untyped("priority"))).rejects.toThrow(
        'average() needs a number attribute: "priority" is an enum',
      );
      expect(events).toEqual([]);
    });

    test("minimum and maximum refuse booleans, json and bytes, which don't order", async () => {
      await expect(reviews().none().minimum(untyped("featured"))).rejects.toThrow(
        `minimum() can't compare "featured", a boolean attribute`,
      );
      expect(events).toEqual([]);
    });
  });

  describe("calculate", () => {
    test("runs the calculation its operation names", async () => {
      await seedReviews(["a", 3, 1.5], ["b", 4, 2], ["c", null, 0.25]);

      expect(await reviews().calculate("count")).toBe(3);
      expect(await reviews().calculate("count", "rating")).toBe(2);
      expect(await reviews().calculate("sum", "rating")).toBe(7);
      expect(await reviews().calculate("average", "score")).toBe(1.25);
      expect(await reviews().calculate("minimum", "rating")).toBe(3);
      expect(await reviews().calculate("maximum", sql`${column("rating")} + 1`)).toBe(5);
    });

    test("rejects an operation it doesn't know with TypeError, before any query", async () => {
      await expect(reviews().calculate(untyped("median"), "rating")).rejects.toThrow(
        'calculate() takes "count", "sum", "average", "minimum" or "maximum", not "median"',
      );
      expect(events).toEqual([]);
    });
  });

  describe("through an association and a Model's statics", () => {
    beforeEach(async () => {
      await harness.reset("posts", "users");
      await harness.exec("INSERT INTO users (id, email) VALUES (1, 'a@example.com')");
      await harness.exec(
        "INSERT INTO posts (id, user_id, title) VALUES (10, 1, 'A'), (11, 1, 'B')",
      );
    });

    test("a loaded association still queries, leaving out its unsaved built records", async () => {
      const user = await db().model(User).find(1);
      await user.posts().toArray();
      user.posts().build({ title: "Z" });

      expect(await user.posts().maximum("title")).toBe("B");
      expect(await user.posts().sum("id")).toBe(21);
    });

    test("a Model's statics calculate on the current database", async () => {
      await seedReviews(["a", 3, 1], ["b", 4, 1]);

      const results = await withDatabase(harness.connect(), async () => [
        await Review.sum("rating"),
        await Review.average("rating"),
        await Review.minimum("rating"),
        await Review.maximum("rating"),
        await Review.calculate("sum", "rating"),
      ]);

      expect(results).toEqual([7, 3.5, 3, 4, 7]);
    });
  });
});
