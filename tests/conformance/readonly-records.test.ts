import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  belongsTo,
  hasMany,
  Model,
  ReadonlyRecord,
} from "../../packages/active-record/src/index.ts";
import type { QueryEvent } from "../../packages/active-record/src/executor.ts";
import { openHarness, type Harness } from "../support/harness.ts";
import { statementKinds } from "../support/statement-kinds.ts";

/** What the callbacks below heard, in order. */
const heard: string[] = [];

class Shelf extends Model.define({
  id: { type: "integer", null: false },
  name: "string",
  volumesCount: "integer",
  isFeatured: "boolean",
  updatedAt: "datetime",
}) {
  static table = "shelves";
  static {
    this.validates("name", { presence: true });
    this.beforeSave(() => void heard.push("beforeSave"));
    this.beforeDestroy(() => void heard.push("beforeDestroy"));
  }
}

/** A shelf that saves its volumes with it, and destroys them with it. */
class Bookcase extends Model.define({
  id: { type: "integer", null: false },
  name: "string",
}) {
  static table = "shelves";
  volumes = hasMany(Volume, { foreignKey: "shelfId", autosave: true, dependent: "destroy" });
}

/** A shelf whose volumes are read-only, destroyed with it. */
class LockedBookcase extends Model.define({
  id: { type: "integer", null: false },
  name: "string",
}) {
  static table = "shelves";
  volumes = hasMany(Volume, {
    foreignKey: "shelfId",
    scope: (q) => q.readonly(),
    dependent: "destroy",
  });
}

class Volume extends Model.define({
  id: { type: "integer", null: false },
  shelfId: "integer",
  title: "string",
}) {
  static table = "volumes";
  shelf = belongsTo(Bookcase, { foreignKey: "shelfId", optional: true });
}

describe("read-only records (#358)", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    heard.length = 0;
    await harness.reset("volumes", "shelves");
    await harness.exec("INSERT INTO shelves (id, name) VALUES (1, 'Fiction')");
  });

  /** A Database whose statements are recorded in `events`. */
  const recorded = (events: QueryEvent[]) =>
    harness.connect({ onQuery: (event) => void events.push(event) });
  /** Shelf 1's row as stored, as a fresh read finds it. */
  const storedShelf = async () => {
    const { name, volumesCount, isFeatured, updatedAt } = await harness
      .connect()
      .model(Shelf)
      .find(1);
    return { name, volumesCount, isFeatured, updatedAt };
  };
  /** Shelf 1's row as seeded. */
  const seeded = { name: "Fiction", volumesCount: 0, isFeatured: false, updatedAt: null };
  /** Shelf 1, loaded and marked read-only, with `events` recording what's sent after. */
  const readonlyShelf = async (events: QueryEvent[]) => {
    const shelf = await recorded(events).model(Shelf).find(1);
    shelf.markReadonly();
    events.length = 0;
    return shelf;
  };

  describe("a record marked read-only", () => {
    test("says it's read-only, and a loaded one isn't", async () => {
      const shelf = await harness.connect().model(Shelf).find(1);
      expect(shelf.isReadonly()).toBe(false);

      shelf.markReadonly();

      expect(shelf.isReadonly()).toBe(true);
    });

    test("can't be saved: it throws, runs nothing and sends nothing", async () => {
      const events: QueryEvent[] = [];
      const shelf = await readonlyShelf(events);
      shelf.name = "";

      const saving = shelf.save();

      await expect(saving).rejects.toThrow(ReadonlyRecord);
      await expect(saving).rejects.toMatchObject({ record: shelf, action: "save" });
      expect(heard).toEqual([]);
      expect(shelf.errors.size).toBe(0); // not validated
      expect(events).toEqual([]);
      expect(await storedShelf()).toEqual(seeded);
    });

    test("saveOrThrow and update are refused the same way", async () => {
      const events: QueryEvent[] = [];
      const shelf = await readonlyShelf(events);

      await expect(shelf.saveOrThrow()).rejects.toThrow(ReadonlyRecord);
      await expect(shelf.update({ name: "Poetry" })).rejects.toThrow(ReadonlyRecord);
      await expect(shelf.updateOrThrow({ name: "Poetry" })).rejects.toThrow(ReadonlyRecord);
      expect(shelf.name).toBe("Fiction"); // refused before it's assigned
      expect(events).toEqual([]);
      expect(await storedShelf()).toEqual(seeded);
    });

    test("can't be destroyed: it throws, runs nothing and sends nothing", async () => {
      const events: QueryEvent[] = [];
      const shelf = await readonlyShelf(events);

      const destroying = shelf.destroy();

      await expect(destroying).rejects.toThrow(ReadonlyRecord);
      await expect(destroying).rejects.toMatchObject({ action: "destroy" });
      await expect(shelf.destroyOrThrow()).rejects.toThrow(ReadonlyRecord);
      expect(heard).toEqual([]);
      expect(events).toEqual([]);
      expect(shelf.isDestroyed()).toBe(false);
      expect(await storedShelf()).toEqual(seeded);
    });

    test.each([
      ["touch", (shelf: Shelf) => shelf.touch()],
      ["updateColumns", (shelf: Shelf) => shelf.updateColumns({ name: "Poetry" })],
      ["updateColumn", (shelf: Shelf) => shelf.updateColumn("name", "Poetry")],
      ["incrementColumn", (shelf: Shelf) => shelf.incrementColumn("volumesCount")],
      ["decrementColumn", (shelf: Shelf) => shelf.decrementColumn("volumesCount")],
      ["toggleColumn", (shelf: Shelf) => shelf.toggleColumn("isFeatured")],
    ])("%s is refused and sends nothing", async (action, write) => {
      const events: QueryEvent[] = [];
      const shelf = await readonlyShelf(events);

      await expect(write(shelf)).rejects.toMatchObject({ name: "ReadonlyRecord", action });
      expect(events).toEqual([]);
      expect(await storedShelf()).toEqual(seeded);
    });

    test("can still be changed in memory and reloaded, and stays read-only", async () => {
      const events: QueryEvent[] = [];
      const shelf = await readonlyShelf(events);
      shelf.name = "Poetry";

      await shelf.reload();

      expect(shelf.name).toBe("Fiction");
      expect(shelf.isReadonly()).toBe(true);
    });
  });

  describe("writes that reach a read-only record through another", () => {
    beforeEach(async () => {
      await harness.exec(
        "INSERT INTO volumes (id, shelf_id, title) VALUES (1, 1, 'Dune'), (2, 1, 'Emma')",
      );
    });

    /** Volume rows as stored, by id. */
    const storedVolumes = async () =>
      await harness.connect().model(Volume).order({ id: "asc" }).pluck("title");

    test("saving its owner, which would autosave its change, throws and sends nothing", async () => {
      const events: QueryEvent[] = [];
      const bookcase = await recorded(events).model(Bookcase).includes("volumes").find(1);
      const [dune] = await bookcase.volumes().toArray();
      dune!.markReadonly().title = "Dune Messiah";
      bookcase.name = "Classics";
      events.length = 0;

      await expect(bookcase.save()).rejects.toMatchObject({ name: "ReadonlyRecord", record: dune });
      expect(events).toEqual([]);
      expect(await storedShelf()).toEqual(seeded);
    });

    test("an unchanged read-only record doesn't stop its owner's save", async () => {
      const bookcase = await harness.connect().model(Bookcase).includes("volumes").find(1);
      for (const volume of await bookcase.volumes().toArray()) volume.markReadonly();
      bookcase.name = "Classics";

      expect(await bookcase.save()).toBe(true);
    });

    test("a batch holding it throws and writes nothing", async () => {
      const events: QueryEvent[] = [];
      const database = recorded(events);
      const [dune, emma] = await database.model(Volume).order({ id: "asc" }).toArray();
      dune!.title = "Dune Messiah";
      emma!.markReadonly().title = "Persuasion";
      events.length = 0;

      await expect(database.batch((b) => [b.save(dune!), b.save(emma!)])).rejects.toThrow(
        ReadonlyRecord,
      );
      expect(events).toEqual([]);
      expect(await storedVolumes()).toEqual(["Dune", "Emma"]);
    });

    test("destroyAll on a readonly() Relation throws before it deletes", async () => {
      const events: QueryEvent[] = [];
      const volumes = recorded(events).model(Volume).readonly();

      await expect(volumes.destroyAll()).rejects.toThrow(ReadonlyRecord);
      expect(statementKinds(events)).toEqual(["SELECT"]); // its records are read, not deleted
      expect(await storedVolumes()).toEqual(["Dune", "Emma"]);
    });

    test("destroying an owner whose dependent record is read-only throws and deletes nothing", async () => {
      const bookcase = await harness.connect().model(LockedBookcase).find(1);

      await expect(bookcase.destroy()).rejects.toThrow(ReadonlyRecord);
      expect(await storedShelf()).toEqual(seeded);
      expect(await storedVolumes()).toEqual(["Dune", "Emma"]);
    });

    test("pushing it onto an association throws and writes nothing", async () => {
      await harness.exec("INSERT INTO shelves (id, name) VALUES (2, 'Poetry')");
      const database = harness.connect();
      const poetry = await database.model(Bookcase).find(2);
      const dune = (await database.model(Volume).find(1)).markReadonly();

      await expect(poetry.volumes().push(dune)).rejects.toThrow(ReadonlyRecord);
      expect(await database.model(Volume).where({ shelfId: 2 }).count()).toBe(0);
    });

    test("updateAll and deleteAll write through a readonly() Relation", async () => {
      const volumes = harness.connect().model(Volume).readonly();

      expect(await volumes.where({ id: 1 }).updateAll({ title: "Dune Messiah" })).toBe(1);
      expect(await volumes.where({ id: 2 }).deleteAll()).toBe(1);
      expect(await storedVolumes()).toEqual(["Dune Messiah"]);
    });
  });
});
