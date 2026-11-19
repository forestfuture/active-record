import { describe, expectTypeOf, test } from "vite-plus/test";
import { Model } from "../../packages/active-record/src/index.ts";

class Article extends Model.define({
  id: { type: "integer", null: false },
  title: "string",
  slug: "string",
}) {}

// Each check is a function that's never called: only its types are tested (#49).
describe("the types of afterFind and afterInitialize (#49)", () => {
  test("the callback gets the Model's record, and may return anything but a promise", () => {
    const check = () => [
      Article.afterFind((article) => {
        expectTypeOf(article).toEqualTypeOf<Article>();
      }),
      Article.afterInitialize((article) => (article.slug = article.title)),
      Article.afterInitialize((article) => void article.title),
      // @ts-expect-error nothing awaits afterFind, so it can't be async.
      Article.afterFind(async () => {}),
      // @ts-expect-error nothing awaits afterInitialize, so it can't return a promise.
      Article.afterInitialize(() => Promise.resolve()),
    ];

    expectTypeOf(check).toBeFunction();
  });
});
