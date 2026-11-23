import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  belongsTo,
  hasMany,
  IncompatibleRelation,
  Model,
  ReadonlyRecord,
  withDatabase,
} from "../../packages/active-record/src/index.ts";
import { openHarness, type Harness } from "../support/harness.ts";

class Shelf extends Model.define({
  id: { type: "integer", null: false },
  name: "string",
}) {
  static table = "shelves";
  volumes = hasMany(Volume);
  lockedVolumes = hasMany(Volume, { scope: (q) => q.readonly() });
  static fixed = this.scope((q) => q.readonly());
}

class Volume extends Model.define({
  id: { type: "integer", null: false },
  shelfId: "integer",
  title: "string",
}) {
  static table = "volumes";
  shelf = belongsTo(Shelf, { optional: true });
}

/** A shelf whose every query is read-only, from its default scope. */
class ArchivedShelf extends Model.define({
  id: { type: "integer", null: false },
  name: "string",
}) {
  static table = "shelves";
  static {
    this.defaultScope((q) => q.readonly());
  }
}

describe("readonly() Relations (#358)", () => {
  let harness: Harness;
  const db = () => harness.connect();

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.reset("volumes", "shelves");
    await harness.exec("INSERT INTO shelves (id, name) VALUES (1, 'Fiction'), (2, 'Poetry')");
    await harness.exec("INSERT INTO volumes (id, shelf_id, title) VALUES (1, 1, 'Dune')");
  });

  /** Whether every record is read-only. */
  const allReadonly = (records: readonly Model[]) => records.map((each) => each.isReadonly());

  describe("the records it loads are read-only", () => {
    test.each([
      ["toArray", () => db().model(Shelf).readonly().order({ id: "asc" }).toArray()],
      ["find", async () => [await db().model(Shelf).readonly().find(1)]],
      ["find with ids", () => db().model(Shelf).readonly().find([1, 2])],
      ["first", async () => [(await db().model(Shelf).readonly().first())!]],
      ["last", async () => [(await db().model(Shelf).readonly().order({ id: "asc" }).last())!]],
      ["take", async () => [(await db().model(Shelf).readonly().take())!]],
      ["findBy", async () => [(await db().model(Shelf).readonly().findBy({ id: 1 }))!]],
      ["sole", async () => [await db().model(Shelf).readonly().where({ id: 2 }).sole()]],
    ])("%s", async (_, load) => {
      const records = await load();

      expect(records.length).toBeGreaterThan(0);
      expect(allReadonly(records)).not.toContain(false);
    });

    test("findEach", async () => {
      const records: Shelf[] = [];
      for await (const shelf of db().model(Shelf).readonly().findEach()) records.push(shelf);

      expect(allReadonly(records)).toEqual([true, true]);
    });

    test("a record it loads refuses to be saved", async () => {
      const shelf = await db().model(Shelf).readonly().find(1);
      shelf.name = "Prose";

      await expect(shelf.save()).rejects.toThrow(ReadonlyRecord);
    });

    test("a Relation without it loads records that aren't", async () => {
      expect((await db().model(Shelf).find(1)).isReadonly()).toBe(false);
    });
  });

  describe("carrying it", () => {
    test("chaining keeps it", async () => {
      const shelves = await db()
        .model(Shelf)
        .readonly()
        .where({ id: 1 })
        .order({ id: "asc" })
        .toArray();

      expect(allReadonly(shelves)).toEqual([true]);
    });

    test("readonly(false) undoes it", async () => {
      expect((await db().model(Shelf).readonly().readonly(false).find(1)).isReadonly()).toBe(false);
    });

    test("merge carries it, and merging readonly(false) undoes it", async () => {
      const shelves = db().model(Shelf);

      expect((await shelves.where({ id: 1 }).merge(shelves.readonly()).sole()).isReadonly()).toBe(
        true,
      );
      expect((await shelves.readonly().merge(shelves.readonly(false)).find(1)).isReadonly()).toBe(
        false,
      );
      expect(
        (
          await shelves
            .readonly()
            .merge(shelves.where({ id: 1 }))
            .sole()
        ).isReadonly(),
      ).toBe(true);
    });

    test("a scope can make it", async () => {
      expect((await db().model(Shelf).fixed().find(1)).isReadonly()).toBe(true);
    });

    test("a default scope makes every query's records read-only, and unscoped() drops it", async () => {
      const shelves = db().model(ArchivedShelf);

      expect((await shelves.find(1)).isReadonly()).toBe(true);
      const unscoped = await withDatabase(db(), () => ArchivedShelf.unscoped().find(1));
      expect(unscoped.isReadonly()).toBe(false);
    });

    test("an association's scope makes its records read-only", async () => {
      const shelf = await db().model(Shelf).find(1);

      expect(allReadonly(await shelf.lockedVolumes().toArray())).toEqual([true]);
      expect(allReadonly(await shelf.volumes().toArray())).toEqual([false]);
    });

    test("an association's scope makes the records includes preloads read-only", async () => {
      const [shelf] = await db().model(Shelf).where({ id: 1 }).includes("lockedVolumes").toArray();

      expect(allReadonly(await shelf!.lockedVolumes().toArray())).toEqual([true]);
    });

    test("an association's records, already loaded, are read again read-only", async () => {
      const shelf = await db().model(Shelf).find(1);
      const loaded = await shelf.volumes().toArray();

      expect(allReadonly(await shelf.volumes().readonly().toArray())).toEqual([true]);
      expect(allReadonly(loaded)).toEqual([false]); // the owner's records aren't marked
    });

    test("or() needs both sides to agree", () => {
      const shelves = db().model(Shelf);

      expect(() => shelves.readonly().or(shelves.where({ id: 2 }))).toThrow(IncompatibleRelation);
    });
  });

  describe("records it doesn't mark", () => {
    test("records preloaded by includes aren't read-only", async () => {
      const [shelf] = await db()
        .model(Shelf)
        .readonly()
        .where({ id: 1 })
        .includes("volumes")
        .toArray();

      expect(shelf!.isReadonly()).toBe(true);
      expect(allReadonly(await shelf!.volumes().toArray())).toEqual([false]);
    });

    test("records built or created through it aren't read-only", async () => {
      const shelves = db().model(Shelf).readonly();

      expect(shelves.build({ name: "Drama" }).isReadonly()).toBe(false);
      const created = await shelves.create({ id: 3, name: "Drama" });

      expect(created.isPersisted()).toBe(true);
      expect(created.isReadonly()).toBe(false);
    });

    test("findOrCreateBy finds a read-only record, and creates one that isn't", async () => {
      const shelves = db().model(Shelf).readonly();

      expect((await shelves.findOrCreateBy({ name: "Fiction" })).isReadonly()).toBe(true);
      expect((await shelves.findOrCreateBy({ id: 4, name: "Essays" })).isReadonly()).toBe(false);
    });
  });
});
