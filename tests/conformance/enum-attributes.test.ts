import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { Model } from "../../packages/active-record/src/index.ts";
import { openHarness, type Harness } from "../support/harness.ts";

class Article extends Model.define({
  id: { type: "integer", null: false },
  title: "string",
  status: { type: "string", enum: ["draft", "published"] },
  priority: { type: "integer", enum: { low: 0, normal: 5, high: 10 } },
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

  describe("an integer enum", () => {
    test("is written and read by name, and its column holds the value the name is stored as", async () => {
      const article = await articles().createOrThrow({ id: 1, priority: "high" });
      article.priority = "low";
      await article.saveOrThrow();

      const rows = await harness.exec("SELECT priority FROM articles");
      const found = await articles().find(1);

      expect(rows).toEqual([{ priority: 0 }]);
      expect(found.priority).toBe("low");
    });

    test("takes a stored value for its name, as a form posts it", () => {
      const article = articles().build({ id: 1, priority: 10 as never });

      expect(article.priority).toBe("high");
      article.assign({ priority: "5" as never });
      expect(article.priority).toBe("normal");
    });

    test("refuses a value it doesn't store", () => {
      expect(() => articles().build({ priority: 7 as never })).toThrow(
        new TypeError('Article: 7 isn\'t one of "low", "normal", "high" for "priority"'),
      );
    });
  });

  describe("an unknown value", () => {
    test("in a condition matches nothing", async () => {
      await articles().createOrThrow({ id: 1, status: "draft", priority: "low" });

      expect(
        await articles()
          .where({ status: "archived" as never })
          .toArray(),
      ).toEqual([]);
      expect(
        await articles()
          .where({ priority: 7 as never })
          .count(),
      ).toBe(0);
    });

    test("in a stored cell throws TypeError when the record loads", async () => {
      await harness.exec("INSERT INTO articles (id, status, priority) VALUES (1, 'archived', 3)");

      await expect(articles().find(1)).rejects.toThrow(
        new TypeError('Article: "archived" isn\'t one of "draft", "published" for "status"'),
      );
      await expect(articles().pluck("priority")).rejects.toThrow(
        new TypeError('Article: 3 isn\'t one of "low", "normal", "high" for "priority"'),
      );
    });
  });

  // Guards: an enum casts through the attribute's value path, as every query and write does.
  describe("in queries and writes", () => {
    beforeEach(async () => {
      await articles().insertAll([
        { id: 1, status: "draft", priority: "high" },
        { id: 2, status: "published", priority: "low" },
        { id: 3, status: "published", priority: "normal" },
      ]);
    });
    const ids = (records: readonly Article[]) => records.map((each) => each.id);

    test("bulk writes store each name as its value", async () => {
      await articles().where({ id: 3 }).updateAll({ priority: "low" });

      const rows = await harness.exec("SELECT status, priority FROM articles ORDER BY id");

      expect(rows).toEqual([
        { status: "draft", priority: 10 },
        { status: "published", priority: 0 },
        { status: "published", priority: 0 },
      ]);
    });

    test("where and whereNot take names, lists of names, and stored values", async () => {
      const byId = articles().order({ id: "asc" });

      expect(ids(await byId.where({ status: "published" }).toArray())).toEqual([2, 3]);
      expect(ids(await byId.where({ priority: ["low", "high"] }).toArray())).toEqual([1, 2]);
      expect(ids(await byId.whereNot({ priority: "low" }).toArray())).toEqual([1, 3]);
      expect(ids(await byId.where({ priority: 10 as never }).toArray())).toEqual([1]);
    });

    test("order sorts by the stored value, and pluck reads names", async () => {
      expect(await articles().order({ priority: "asc" }).pluck("priority")).toEqual([
        "low",
        "normal",
        "high",
      ]);
    });

    test("a record's changes are names", async () => {
      const article = await articles().find(1);
      article.priority = "low";

      expect(article.changes()).toEqual({ priority: ["high", "low"] });
    });

    test("typeForAttribute converts between names and stored values", () => {
      const priority = Article.typeForAttribute("priority");

      expect(priority.cast("10")).toBe("high");
      expect(priority.serialize("normal")).toBe(5);
      expect(priority.deserialize(0)).toBe("low");
    });
  });
});
