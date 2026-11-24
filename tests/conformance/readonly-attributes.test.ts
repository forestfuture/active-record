import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  belongsTo,
  hasMany,
  InvalidModel,
  Model,
  ReadonlyAttribute,
  type TableAttributes,
} from "../../packages/arbor/src/index.ts";
import { d1 } from "../../packages/arbor/src/adapters/d1/index.ts";
import type { QueryEvent } from "../../packages/arbor/src/executor.ts";
import { openHarness, type Harness } from "../support/harness.ts";
import { statementKinds } from "../support/statement-kinds.ts";

class Volume extends Model.define({
  id: { type: "integer", null: false },
  title: "string",
  slug: { type: "string", readonly: true },
  code: "string",
}) {
  static table = "volumes";
  static {
    this.normalizes("slug", { with: (slug) => slug.trim().toLowerCase() });
  }
}

/** A volume whose shelf and details are set when it's created. */
class FixedVolume extends Model.define({
  id: { type: "integer", null: false },
  shelfId: { type: "integer", readonly: true },
  details: { type: "json", readonly: true },
  shelvedAt: { type: "datetime", readonly: true },
  stampedOn: { aliasOf: "shelvedAt" },
}) {
  static table = "volumes";
  shelf = belongsTo(Shelf, { foreignKey: "shelfId", optional: true });
}

class Shelf extends Model.define({
  id: { type: "integer", null: false },
  name: "string",
  volumesCount: "integer",
  openedAt: { type: "datetime", readonly: true },
}) {
  static table = "shelves";
  volumes = hasMany(FixedVolume, { foreignKey: "shelfId" });
}

/** A volume that stamps its shelf's opening time, which can't change, whenever it's written. */
class StampingVolume extends Model.define({
  id: { type: "integer", null: false },
  shelfId: "integer",
  title: "string",
}) {
  static table = "volumes";
  shelf = belongsTo(Shelf, { foreignKey: "shelfId", touch: "openedAt" });
}

/** A shelf counting its volumes in a column a save can't change. */
class CountedShelf extends Model.define({
  id: { type: "integer", null: false },
  name: "string",
  volumesCount: { type: "integer", readonly: true },
}) {
  static table = "shelves";
  volumes = hasMany(CountedVolume, { foreignKey: "shelfId" });
}

class CountedVolume extends Model.define({
  id: { type: "integer", null: false },
  shelfId: "integer",
  title: "string",
}) {
  static table = "volumes";
  shelf = belongsTo(CountedShelf, { foreignKey: "shelfId", counterCache: "volumesCount" });
}

// A generated schema's volumes table, whose Model makes its slug read-only by an override.
const schema = {
  adapter: d1({ binding: "DB" }),
  tables: {
    volumes: {
      attributes: { id: { type: "integer", null: false }, title: "string", slug: "string" },
      primaryKey: "id",
    },
  },
} as const;

abstract class ApplicationRecord extends Model {
  static override schema = schema;
}

// The interface stands in for the declarations arbor schema generates in another file.
/* oxlint-disable typescript/no-unsafe-declaration-merging */
class Edition extends ApplicationRecord {
  static override table = "volumes";
  static override attributes = { slug: { readonly: true } } as const;
}
interface Edition extends TableAttributes<
  typeof schema.tables.volumes.attributes,
  (typeof Edition)["attributes"]
> {}
/* oxlint-enable typescript/no-unsafe-declaration-merging */

describe("read-only attributes (#358)", () => {
  let harness: Harness;
  const db = () => harness.connect();

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.reset("volumes");
    await harness.exec(
      "INSERT INTO volumes (id, title, slug, code) VALUES (1, 'Dune', 'dune', 'D-1')",
    );
  });

  /** Volume 1's slug and title as stored. */
  const stored = async () => {
    const { slug, title } = await db().model(Volume).find(1);
    return { slug, title };
  };

  test("is written when a record is created", async () => {
    const created = await db().model(Volume).create({ id: 2, title: "Emma", slug: "emma" });

    expect(created.slug).toBe("emma");
    expect((await db().model(Volume).find(2)).slug).toBe("emma");
  });

  test("a new record can change it before it's saved", () => {
    const volume = db().model(Volume).build({ slug: "emma" });

    volume.slug = "persuasion";

    expect(volume.slug).toBe("persuasion");
  });

  test("assigning a persisted record a new value throws, and sends nothing", async () => {
    const events: QueryEvent[] = [];
    const volume = await harness
      .connect({ onQuery: (event) => void events.push(event) })
      .model(Volume)
      .find(1);
    events.length = 0;

    expect(() => (volume.slug = "dune-messiah")).toThrow(ReadonlyAttribute);
    expect(() => volume.assign({ slug: "dune-messiah" })).toThrow(
      expect.objectContaining({ attribute: "slug" }),
    );
    await expect(volume.update({ title: "Dune!", slug: "dune-messiah" })).rejects.toThrow(
      ReadonlyAttribute,
    );
    await expect(volume.updateColumns({ slug: "dune-messiah" })).rejects.toThrow(ReadonlyAttribute);

    expect(volume.slug).toBe("dune");
    expect(events).toEqual([]);
    expect(await stored()).toEqual({ slug: "dune", title: "Dune" });
  });

  test("assigning the value it holds, once normalized, is no change: a form can post it back", async () => {
    const volume = await db().model(Volume).find(1);

    expect(await volume.update({ title: "Dune!", slug: "  DUNE " })).toBe(true);

    expect(volume.isAttributeChanged("slug")).toBe(false);
    expect(await stored()).toEqual({ slug: "dune", title: "Dune!" });
  });

  test("reload() can still change it", async () => {
    const volume = await db().model(Volume).find(1);
    await harness.exec("UPDATE volumes SET slug = 'arrakis' WHERE id = 1");

    await volume.reload();

    expect(volume.slug).toBe("arrakis");
  });

  test("an upsert doesn't overwrite it on conflict, and inserts it on a new row", async () => {
    const volumes = db().model(Volume);

    await volumes.upsertAll(
      [
        { id: 1, title: "Dune Messiah", slug: "messiah", code: "D-1" },
        { id: 2, title: "Emma", slug: "emma", code: "E-1" },
      ],
      { uniqueBy: "code" },
    );

    expect(await stored()).toEqual({ slug: "dune", title: "Dune Messiah" });
    expect((await volumes.find(2)).slug).toBe("emma");
  });

  describe("changed another way than by assigning it", () => {
    beforeEach(async () => {
      await harness.reset("volumes", "shelves");
      await harness.exec("INSERT INTO shelves (id, name) VALUES (1, 'Fiction'), (2, 'Poetry')");
      await harness.exec(
        "INSERT INTO volumes (id, shelf_id, title, details) VALUES (1, 1, 'Dune', '{\"pages\":412}')",
      );
    });

    /** Volume 1's shelf and details as stored. */
    const fixed = async () => {
      const { shelfId, details } = await db().model(FixedVolume).find(1);
      return { shelfId, details };
    };
    const seeded = { shelfId: 1, details: { pages: 412 } };

    test("pointing its belongsTo at another record throws", async () => {
      const database = db();
      const volume = await database.model(FixedVolume).find(1);
      const poetry = await database.model(Shelf).find(2);

      expect(() => volume.shelf.set(poetry)).toThrow(ReadonlyAttribute);
      expect(await fixed()).toEqual(seeded);
    });

    test("a null key pointed at a new record throws on save, before the record is inserted", async () => {
      await harness.exec("UPDATE volumes SET shelf_id = NULL WHERE id = 1");
      const events: QueryEvent[] = [];
      const database = recorded(events);
      const volume = await database.model(FixedVolume).find(1);
      volume.shelf.set(database.model(Shelf).build({ name: "Drama" }));
      events.length = 0;

      await expect(volume.save()).rejects.toMatchObject({ attribute: "shelfId" });
      expect(events).toEqual([]);
    });

    test("a null key a new owner would fill throws on its save, before it's inserted", async () => {
      await harness.exec("UPDATE volumes SET shelf_id = NULL WHERE id = 1");
      const events: QueryEvent[] = [];
      const database = recorded(events);
      const volume = await database.model(FixedVolume).find(1);
      const shelf = database.model(Shelf).build({ name: "Drama" });
      await shelf.volumes().push(volume);
      events.length = 0;

      await expect(shelf.save()).rejects.toMatchObject({ attribute: "shelfId" });
      expect(events).toEqual([]);
    });

    test("a json value changed in place isn't saved: the save throws, sending nothing", async () => {
      const events: QueryEvent[] = [];
      const volume = await harness
        .connect({ onQuery: (event) => void events.push(event) })
        .model(FixedVolume)
        .find(1);
      (volume.details as { pages: number }).pages = 500;
      events.length = 0;

      await expect(volume.save()).rejects.toMatchObject({
        name: "ReadonlyAttribute",
        attribute: "details",
      });
      expect(events).toEqual([]);
      expect(await fixed()).toEqual(seeded);
    });

    /** A Database whose statements are recorded in `events`. */
    const recorded = (events: QueryEvent[]) =>
      harness.connect({ onQuery: (event) => void events.push(event) });

    test.each([
      ["by its name", "shelvedAt"],
      ["by an alias", "stampedOn"],
    ])("touch() of a read-only datetime %s throws, sending nothing", async (_, name) => {
      const events: QueryEvent[] = [];
      const volume = await recorded(events).model(FixedVolume).find(1);
      events.length = 0;

      await expect(volume.touch(name as never)).rejects.toThrow(ReadonlyAttribute);
      expect(events).toEqual([]);
    });

    test("a Date changed in place isn't saved: the save throws, sending nothing", async () => {
      await harness.exec("UPDATE volumes SET shelved_at = ? WHERE id = 1", [
        "2026-01-15T00:00:00.000Z",
      ]);
      const events: QueryEvent[] = [];
      const volume = await recorded(events).model(FixedVolume).find(1);
      volume.shelvedAt!.setUTCFullYear(2020);
      events.length = 0;

      await expect(volume.save()).rejects.toMatchObject({ attribute: "shelvedAt" });
      expect(events).toEqual([]);
    });

    test("an association's touch of a read-only datetime throws, sending nothing", async () => {
      const events: QueryEvent[] = [];
      const volume = await recorded(events).model(StampingVolume).find(1);
      volume.title = "Dune Messiah";
      events.length = 0;

      await expect(volume.save()).rejects.toMatchObject({ attribute: "openedAt" });
      expect(statementKinds(events)).toEqual(["SELECT"]); // the shelf is read, and nothing written
    });

    test("a counter's touch of a read-only datetime throws, sending nothing", async () => {
      const events: QueryEvent[] = [];
      const shelf = await recorded(events).model(Shelf).find(1);
      events.length = 0;

      await expect(shelf.incrementColumn("volumesCount", 1, { touch: "openedAt" })).rejects.toThrow(
        ReadonlyAttribute,
      );
      expect(events).toEqual([]);
    });
  });

  test("a counter cache keeps counting it, and its loaded record takes the count", async () => {
    await harness.reset("volumes", "shelves");
    await harness.exec("INSERT INTO shelves (id, name, volumes_count) VALUES (1, 'Fiction', 0)");
    const shelf = await db().model(CountedShelf).find(1);

    await shelf.volumes().create({ title: "Emma" });

    expect(shelf.volumesCount).toBe(1);
    expect(shelf.isChanged()).toBe(false);
    expect((await db().model(CountedShelf).find(1)).volumesCount).toBe(1);
  });

  test("updateAll writes it", async () => {
    await db().model(Volume).where({ id: 1 }).updateAll({ slug: "arrakis" });

    expect(await stored()).toEqual({ slug: "arrakis", title: "Dune" });
  });

  test("a generated Model's override makes it read-only", async () => {
    const edition = await db().model(Edition).find(1);

    expect(() => (edition.slug = "arrakis")).toThrow(ReadonlyAttribute);
  });

  test.each([
    ["updatedAt", { type: "datetime", readonly: true }],
    ["lockVersion", { type: "integer", readonly: true }],
  ])("a read-only %s, which every save writes, is an InvalidModel", (name, spec) => {
    class Broken extends Model.define({
      id: { type: "integer", null: false },
      [name]: spec as never,
    }) {
      static table = "volumes";
    }

    expect(() => db().model(Broken)).toThrow(
      new InvalidModel(`Broken.${name} is written by every save, so it can't be readonly`),
    );
  });

  test.each([
    ["virtual", { type: "string", virtual: true, readonly: true }],
    ["secureToken", { type: "string", secureToken: true, readonly: true }],
    ["securePassword", { type: "string", virtual: true, securePassword: true, readonly: true }],
  ])("a read-only attribute declared with %s is an InvalidModel", (_, spec) => {
    class Broken extends Model.define({
      id: { type: "integer", null: false },
      slug: spec as never,
      slugDigest: "string",
    }) {
      static table = "volumes";
    }

    expect(() => db().model(Broken)).toThrow(InvalidModel);
  });
});
