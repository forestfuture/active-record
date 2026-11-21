import { describe, expectTypeOf, test } from "vite-plus/test";
import { defineType, Model } from "../../packages/active-record/src/index.ts";
import { Post } from "../fixtures/models/post.ts";
import { User } from "../fixtures/models/user.ts";

/** A custom type whose values are numbers: still not one `increment` can add to. */
const score = defineType({
  storedAs: "integer",
  cast: (input: unknown) => Number(input),
  serialize: (value: number) => value,
  deserialize: (stored) => Number(stored),
});

class Article extends Model.define({
  id: { type: "integer", null: false },
  title: "string",
  views: { type: "integer", null: false },
  rating: "real",
  price: "decimal",
  isPinned: "boolean",
  status: { type: "integer", enum: { draft: 0, published: 1 } },
  score: { type: score },
  bareScore: score,
  publishedAt: "datetime",
  updatedAt: "datetime",
}) {}

// Each check is a function that's never called: only its types are tested.
describe("the types of changing one attribute (#351)", () => {
  test("increment and its kin take number attributes only", () => {
    const check = (article: Article): Article => {
      const same: Article = article.increment("views").decrement("rating", 2);
      void article.incrementColumn("views", 3);
      void article.decrementColumn("rating");
      // @ts-expect-error A string attribute isn't a number.
      article.increment("title");
      // @ts-expect-error A decimal is text, refused until #480.
      void article.incrementColumn("price");
      // @ts-expect-error An enum's values are its names.
      article.decrement("status");
      // @ts-expect-error A custom type is refused, even one whose values are numbers.
      article.increment("score");
      // @ts-expect-error A custom type given bare, not as { type }, is refused too.
      article.increment("bareScore");
      // @ts-expect-error Nor is it a boolean.
      article.toggle("bareScore");
      return same;
    };

    expectTypeOf(check).toBeFunction();
  });

  test("a generated Model's attributes are read from its schema and overrides", () => {
    const check = (user: User, post: Post) => {
      user.increment("age");
      post.toggle("published"); // an integer column the Model overrides as a boolean
      // @ts-expect-error A text column isn't a number.
      user.increment("email");
    };

    expectTypeOf(check).toBeFunction();
  });

  test("toggle and toggleColumn take boolean attributes only", () => {
    const check = (article: Article) => {
      article.toggle("isPinned");
      void article.toggleColumn("isPinned");
      // @ts-expect-error A number attribute isn't a boolean.
      article.toggle("views");
    };

    expectTypeOf(check).toBeFunction();
  });

  test("updateColumns takes declared attributes with their values' types", () => {
    const check = async (article: Article) => {
      const written: boolean = await article.updateColumns({ title: "New", views: 2 });
      await article.updateColumn("isPinned", true);
      // @ts-expect-error An attribute the Model doesn't declare.
      await article.updateColumns({ body: "text" });
      // @ts-expect-error A value of another type.
      await article.updateColumn("views", "2");
      return written;
    };

    expectTypeOf(check).toBeFunction();
  });

  test("updateCounters and the counter statics take number attributes only", () => {
    const check = async () => {
      const rows: number = await Article.updateCounters([1, 2], { views: 1, rating: -1 });
      await Article.where({ id: 1 }).updateCounters({ views: 2 });
      await Article.incrementCounter("views", 1, { by: 2 });
      // @ts-expect-error by goes in the options.
      await Article.incrementCounter("views", 1, 2);
      await Article.decrementCounter("rating", [1, 2]);
      // @ts-expect-error A string attribute isn't a counter.
      await Article.updateCounters(1, { title: 1 });
      // @ts-expect-error A boolean attribute isn't a counter.
      await Article.incrementCounter("isPinned", 1);
      return rows;
    };

    expectTypeOf(check).toBeFunction();
  });
});

describe("the types of touch (#50)", () => {
  test("touch and touchAll take datetime attributes, then { time }", () => {
    const check = async (article: Article) => {
      expectTypeOf(await article.touch()).toEqualTypeOf<boolean>();
      await article.touch("publishedAt", "updatedAt", { time: new Date() });
      await article.touch({ time: new Date() });
      // @ts-expect-error A string attribute isn't a datetime.
      await article.touch("title");
      // @ts-expect-error The options come last.
      await article.touch({ time: new Date() }, "publishedAt");
      // @ts-expect-error time is a Date.
      await article.touch({ time: "now" });
      expectTypeOf(
        await Article.where({ isPinned: true }).touchAll("publishedAt"),
      ).toEqualTypeOf<number>();
      await Article.touchAll({ time: new Date() });
      // @ts-expect-error A number attribute isn't a datetime.
      await Article.touchAll("views");
    };

    expectTypeOf(check).toBeFunction();
  });

  test("incrementColumn's touch names datetime attributes", () => {
    const check = async (article: Article) => {
      await article.incrementColumn("views", 1, { touch: true });
      await article.decrementColumn("views", 1, { touch: ["publishedAt"] });
      // @ts-expect-error A string attribute isn't a datetime.
      await article.incrementColumn("views", 1, { touch: "title" });
    };

    expectTypeOf(check).toBeFunction();
  });
});
