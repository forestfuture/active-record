import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { belongsTo, hasMany, Model, StaleRecord } from "../../packages/active-record/src/index.ts";
import type { QueryEvent } from "../../packages/active-record/src/executor.ts";
import { openHarness, type Harness } from "../support/harness.ts";

/** A notebook whose `lockVersion` turns on optimistic locking. */
class Notebook extends Model.define({
  id: { type: "integer", null: false },
  title: "string",
  pagesCount: "integer",
  lockVersion: { type: "integer", null: false, default: () => 0 },
  updatedAt: "datetime",
}) {
  static table = "notebooks";
  pages = hasMany(Page, { dependent: "destroy" });
}

/** What a page's `afterRollback` saw. */
const rolledBack: string[] = [];

/** A locked page, counted and touching its notebook. */
class Page extends Model.define({
  id: { type: "integer", null: false },
  notebookId: "integer",
  body: "string",
  lockVersion: { type: "integer", null: false, default: () => 0 },
  updatedAt: "datetime",
}) {
  static table = "pages";
  notebook = belongsTo(Notebook, { counterCache: true, touch: true });

  static {
    this.afterRollback((page) => {
      rolledBack.push(page.body ?? "");
    });
  }
}

describe("optimistic locking", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());

  const events: QueryEvent[] = [];
  const db = () => harness.connect({ onQuery: (event) => events.push(event) });
  const rows = (table: string) => harness.exec(`SELECT * FROM ${table} ORDER BY id`);
  beforeEach(async () => {
    events.length = 0;
    rolledBack.length = 0;
    await harness.reset("pages", "notebooks", "drafts");
    await harness.exec("INSERT INTO notebooks (id, title, pages_count) VALUES (1, 'Recipes', 1)");
    await harness.exec("INSERT INTO notebooks (id, title, pages_count) VALUES (2, 'Travel', 0)");
    await harness.exec("INSERT INTO pages (id, notebook_id, body) VALUES (1, 1, 'Soup')");
  });

  /** Two copies of notebook 1, as two requests load it. */
  async function twoCopies() {
    const first = await db().model(Notebook).find(1);
    const second = await db().model(Notebook).find(1);
    return [first, second] as const;
  }

  describe("saving", () => {
    test("the first copy's save increments lockVersion, and the stale copy's throws StaleRecord", async () => {
      const [first, second] = await twoCopies();

      first.title = "Soups";
      await first.saveOrThrow();
      second.title = "Breads";
      const saving = second.save();

      await expect(saving).rejects.toThrow(StaleRecord);
      await expect(saving).rejects.toMatchObject({ record: second, action: "update" });
      expect(first.lockVersion).toBe(1);
      expect(second.lockVersion).toBe(0);
      expect(second.title).toBe("Breads");
      expect((await rows("notebooks"))[0]).toMatchObject({ title: "Soups", lock_version: 1 });
    });

    // A guard: the guard fails the whole batch, so this passes with the first slice.
    test("a stale save keeps nothing else its write had: counter caches, touches, and the other records of a batch", async () => {
      const notebooksBefore = await rows("notebooks");
      const database = db();
      const first = await db().model(Page).find(1);
      const second = await database.model(Page).find(1);
      first.body = "Stew";
      await first.saveOrThrow();
      const other = await database.model(Notebook).find(2);
      other.title = "Trips";
      second.notebookId = 2;
      second.body = "Bread";

      await expect(second.save()).rejects.toThrow(StaleRecord);
      await expect(database.batch((b) => [b.save(other), b.save(second)])).rejects.toThrow(
        StaleRecord,
      );

      expect(rolledBack).toEqual(["Bread", "Bread"]);
      const notebooks = await rows("notebooks");
      expect(notebooks.map(({ pages_count, title }) => ({ pages_count, title }))).toEqual(
        notebooksBefore.map(({ pages_count, title }) => ({ pages_count, title })),
      );
      expect(notebooks[1]?.updated_at).toBe(notebooksBefore[1]?.updated_at);
      expect(await rows("pages")).toMatchObject([
        { notebook_id: 1, body: "Stew", lock_version: 1 },
      ]);
    });
  });
  describe("destroying", () => {
    test("a stale copy's destroy throws StaleRecord, and keeps its row and its dependents", async () => {
      const [first, second] = await twoCopies();
      first.title = "Soups";
      await first.saveOrThrow();

      const destroying = second.destroy();

      await expect(destroying).rejects.toThrow(StaleRecord);
      await expect(destroying).rejects.toMatchObject({ record: second, action: "destroy" });
      expect(second.isDestroyed()).toBe(false);
      expect(await rows("notebooks")).toHaveLength(2);
      expect(await rows("pages")).toHaveLength(1);
    });

    test("a fresh copy's destroy deletes its row", async () => {
      const [, second] = await twoCopies();

      await second.destroyOrThrow();

      expect(await rows("notebooks")).toHaveLength(1);
    });
  });
});
