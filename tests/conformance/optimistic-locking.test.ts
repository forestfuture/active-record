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

/** A draft, whose `lock_version` has no default and may be NULL. */
class Draft extends Model.define({
  id: { type: "integer", null: false },
  body: "string",
  lockVersion: "integer",
}) {
  static table = "drafts";
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
  describe("a version from a form", () => {
    // A guard: the version checked is the record's, so an assigned one is checked as it is.
    test("an assigned lockVersion is the one checked: an old one throws StaleRecord, the current one saves", async () => {
      const [first] = await twoCopies();
      first.title = "Soups";
      await first.saveOrThrow();
      const edited = await db().model(Notebook).find(1);
      const formVersion = 0;

      edited.assign({ title: "Breads", lockVersion: formVersion });
      await expect(edited.save()).rejects.toThrow(StaleRecord);

      edited.assign({ title: "Breads", lockVersion: 1 });
      await edited.saveOrThrow();
      expect(edited.lockVersion).toBe(2);
      expect((await rows("notebooks"))[0]).toMatchObject({ title: "Breads", lock_version: 2 });
    });
  });

  describe("a NULL version", () => {
    test("reads as 0, and the first save of either copy sets 1 while the other's throws StaleRecord", async () => {
      await harness.exec("INSERT INTO drafts (id, body) VALUES (1, 'Notes')");
      const first = await db().model(Draft).find(1);
      const second = await db().model(Draft).find(1);
      expect(first.lockVersion).toBe(0);
      expect(first.changed()).toEqual([]);

      first.body = "More notes";
      await first.saveOrThrow();
      second.body = "Other notes";

      await expect(second.save()).rejects.toThrow(StaleRecord);
      expect(await rows("drafts")).toMatchObject([{ body: "More notes", lock_version: 1 }]);
    });

    test("a new record without one is written with 0", async () => {
      const draft = await db().model(Draft).createOrThrow({ id: 2, body: "Ideas" });

      expect(draft.lockVersion).toBe(0);
      expect(await rows("drafts")).toMatchObject([{ id: 2, lock_version: 0 }]);
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
  describe("touching", () => {
    test("touch() increments lockVersion, and a stale copy's touch throws StaleRecord and writes nothing", async () => {
      const [first, second] = await twoCopies();

      await first.touch();
      const touching = second.touch();

      await expect(touching).rejects.toThrow(StaleRecord);
      await expect(touching).rejects.toMatchObject({ record: second, action: "touch" });
      expect(first.lockVersion).toBe(1);
      expect(first.changed()).toEqual([]);
      const [row] = await rows("notebooks");
      expect(row?.lock_version).toBe(1);
      expect(new Date(row?.updated_at as string).getTime()).toBe(first.updatedAt?.getTime());
    });
  });
  describe("what doesn't check", () => {
    // A guard: these write straight to the row, and never read the lock.
    test("updateColumns, incrementColumn, updateCounters, updateAll and deleteAll neither check nor bump it", async () => {
      const [first, second] = await twoCopies();
      first.title = "Soups";
      await first.saveOrThrow();

      expect(await second.updateColumns({ title: "Breads" })).toBe(true);
      expect(await second.incrementColumn("pagesCount")).toBe(true);
      await db().model(Notebook).where({ id: 1 }).updateCounters({ pagesCount: 1 });
      await db().model(Notebook).where({ id: 1 }).updateAll({ title: "Cakes" });
      expect((await rows("notebooks"))[0]).toMatchObject({ title: "Cakes", lock_version: 1 });

      await harness.exec("DELETE FROM pages");
      await db().model(Notebook).where({ id: 1 }).deleteAll();
      expect(await rows("notebooks")).toHaveLength(1);
    });

    // A guard: a clean save sends nothing, so it has nothing to lock.
    test("a save with no changes sends nothing, and keeps its version", async () => {
      const [first] = await twoCopies();
      events.length = 0;

      await first.saveOrThrow();

      expect(events).toEqual([]);
      expect(first.lockVersion).toBe(0);
    });
  });
});
