import { describe, expectTypeOf, test } from "vite-plus/test";
import { Model } from "../../packages/active-record/src/index.ts";

class Article extends Model.define({
  id: { type: "integer", null: false },
  title: "string",
  views: { type: "integer", null: false },
  rating: "real",
  price: "decimal",
  isPinned: "boolean",
  status: { type: "integer", enum: { draft: 0, published: 1 } },
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
      return same;
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
