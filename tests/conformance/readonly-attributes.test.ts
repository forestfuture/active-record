import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  InvalidModel,
  Model,
  ReadonlyAttribute,
  type TableAttributes,
} from "../../packages/active-record/src/index.ts";
import { d1 } from "../../packages/active-record/src/adapters/d1/index.ts";
import type { QueryEvent } from "../../packages/active-record/src/executor.ts";
import { openHarness, type Harness } from "../support/harness.ts";

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

// The interface stands in for the declarations active-record schema generates in another file.
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

  test("updateAll writes it", async () => {
    await db().model(Volume).where({ id: 1 }).updateAll({ slug: "arrakis" });

    expect(await stored()).toEqual({ slug: "arrakis", title: "Dune" });
  });

  test("a generated Model's override makes it read-only", async () => {
    const edition = await db().model(Edition).find(1);

    expect(() => (edition.slug = "arrakis")).toThrow(ReadonlyAttribute);
  });

  test.each([
    ["virtual", { type: "string", virtual: true, readonly: true }],
    ["secureToken", { type: "string", secureToken: true, readonly: true }],
  ])("a read-only attribute declared with %s is an InvalidModel", (_, spec) => {
    class Broken extends Model.define({
      id: { type: "integer", null: false },
      slug: spec as never,
    }) {
      static table = "volumes";
    }

    expect(() => db().model(Broken)).toThrow(InvalidModel);
  });
});
