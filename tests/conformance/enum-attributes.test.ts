import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { Model } from "../../packages/active-record/src/index.ts";
import { openHarness, type Harness } from "../support/harness.ts";

class Article extends Model.define({
  id: { type: "integer", null: false },
  title: "string",
  status: { type: "string", enum: ["draft", "published"] },
}) {}

describe("enum attributes (#340)", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.reset("articles");
  });

  const articles = () => harness.connect().model(Article);

  describe("a string enum", () => {
    test("is written and read by name, and its column holds the name", async () => {
      const article = await articles().createOrThrow({ id: 1, status: "draft" });
      article.status = "published";
      await article.saveOrThrow();

      const rows = await harness.exec("SELECT status FROM articles");
      const found = await articles().find(1);

      expect(rows).toEqual([{ status: "published" }]);
      expect(found.status).toBe("published");
    });

    test("refuses a name it doesn't have when one is assigned", () => {
      const article = articles().build({ id: 1 });

      expect(() => {
        article.status = "archived" as never;
      }).toThrow(
        new TypeError('Article: "archived" isn\'t one of "draft", "published" for "status"'),
      );
    });
  });
});
