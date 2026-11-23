import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { column, gte, incoming, Model } from "../../packages/active-record/src/index.ts";
import { openHarness, type Harness } from "../support/harness.ts";

class Doc extends Model.define({
  id: { type: "integer", null: false },
  folderId: "integer",
  settings: "json",
}) {
  static table = "json_docs";
}

/** What a `column()` or `incoming()` given where a fragment could take it throws (#539). */
const writeInFragment = (method: string, given: string) =>
  new TypeError(
    `${method}() gives ${given} a column() or incoming() reference; write it in an sql\`…\` fragment`,
  );

/** What a `column()` or `incoming()` given where no fragment could be throws (#539). */
const giveValueItself = (given: string) =>
  new TypeError(
    `Doc "${given}" was given a column() or incoming() reference; give the value itself`,
  );

describe("column(), its typed values and incoming() given as a value (#539)", () => {
  let harness: Harness;
  const docs = () => harness.connect().model(Doc);
  const stored = () => harness.exec("SELECT id, folder_id, settings FROM json_docs ORDER BY id");

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.reset("json_docs");
    await harness.exec(`INSERT INTO json_docs (id, folder_id, settings) VALUES (1, 7, '{"a":1}')`);
  });

  describe("updateAll refuses it, leaving the rows as they were", () => {
    test("a column() reference", async () => {
      const before = await stored();

      await expect(docs().updateAll({ settings: column("folderId") as never })).rejects.toThrow(
        writeInFragment("updateAll", "settings"),
      );
      await expect(docs().updateAll({ folderId: column("id") as never })).rejects.toThrow(
        writeInFragment("updateAll", "folderId"),
      );
      expect(await stored()).toEqual(before);
    });

    test("a typed value or an incoming() reference", async () => {
      const before = await stored();

      await expect(
        docs().updateAll({ folderId: column("folderId").value(8) as never }),
      ).rejects.toThrow(
        new TypeError("updateAll() gives folderId a typed value; give the value itself"),
      );
      await expect(docs().updateAll({ settings: incoming("settings") as never })).rejects.toThrow(
        writeInFragment("updateAll", "settings"),
      );
      expect(await stored()).toEqual(before);
    });
  });

  describe("a condition refuses it", () => {
    test("as the value, a list's item, or a comparison's value", () => {
      expect(() => docs().where({ folderId: column("id") as never })).toThrow(
        writeInFragment("where", "folderId"),
      );
      expect(() => docs().where({ folderId: [1, column("id") as never] })).toThrow(
        writeInFragment("where", "folderId"),
      );
      expect(() => docs().where({ folderId: gte(column("id") as never) })).toThrow(
        writeInFragment("where", "folderId"),
      );
      expect(() => docs().where({ folderId: column("id").value(1) as never })).toThrow(
        new TypeError("where() gives folderId a typed value; give the value itself"),
      );
    });

    test("in inOrderOf's list", () => {
      expect(() => docs().inOrderOf("folderId", [7, column("id") as never])).toThrow(
        writeInFragment("inOrderOf", "folderId"),
      );
    });

    test("in whereNot, rewhere, and findBy and findOrCreateBy, which say where()", async () => {
      expect(() => docs().whereNot({ settings: column("id") as never })).toThrow(
        writeInFragment("whereNot", "settings"),
      );
      expect(() => docs().rewhere({ settings: incoming("id") as never })).toThrow(
        writeInFragment("rewhere", "settings"),
      );
      await expect(docs().findBy({ settings: column("id") as never })).rejects.toThrow(
        writeInFragment("where", "settings"),
      );
      await expect(docs().findOrCreateBy({ settings: column("id") as never })).rejects.toThrow(
        writeInFragment("where", "settings"),
      );
      expect(await stored()).toHaveLength(1);
    });
  });

  describe("a written row refuses it, writing nothing", () => {
    test("insert and insertAll", async () => {
      await expect(docs().insert({ id: 2, settings: column("id") as never })).rejects.toThrow(
        giveValueItself("settings"),
      );
      await expect(
        docs().insertAll([{ id: 2, folderId: incoming("folderId") as never }]),
      ).rejects.toThrow(giveValueItself("folderId"));
      await expect(
        docs().insertAll([{ id: 2, folderId: column("folderId").value(1) as never }]),
      ).rejects.toThrow(
        new TypeError(`Doc "folderId" was given a typed value; give the value itself`),
      );
      expect(await stored()).toHaveLength(1);
    });

    test("upsert and upsertAll", async () => {
      const before = await stored();

      await expect(docs().upsert({ id: 1, settings: column("id") as never })).rejects.toThrow(
        giveValueItself("settings"),
      );
      await expect(
        docs().upsertAll([{ id: 2, settings: incoming("settings") as never }], { uniqueBy: "id" }),
      ).rejects.toThrow(giveValueItself("settings"));
      expect(await stored()).toEqual(before);
    });

    test("createWith", async () => {
      await expect(
        docs()
          .createWith({ settings: column("id") as never })
          .findOrCreateBy({ id: 2 }),
      ).rejects.toThrow(giveValueItself("settings"));
      expect(await stored()).toHaveLength(1);
    });
  });

  describe("a record refuses it, keeping its value", () => {
    test("in build, a setter, and update", async () => {
      expect(() => docs().build({ settings: column("id") as never })).toThrow(
        giveValueItself("settings"),
      );

      const doc = await docs().find(1);
      expect(() => {
        doc.settings = incoming("settings") as never;
      }).toThrow(giveValueItself("settings"));
      await expect(doc.update({ folderId: column("folderId") as never })).rejects.toThrow(
        giveValueItself("folderId"),
      );
      expect(doc.settings).toEqual({ a: 1 });
      expect(doc.folderId).toBe(7);
      expect((await docs().find(1)).folderId).toBe(7);
    });
  });

  describe("find refuses it as an id (#546)", () => {
    test("as the only id, or one of several", async () => {
      await expect(docs().find(column("id") as never)).rejects.toThrow(
        new TypeError("find() gives id a column() or incoming() reference; give the value itself"),
      );
      await expect(docs().find(1, incoming("id") as never)).rejects.toThrow(
        new TypeError("find() gives id a column() or incoming() reference; give the value itself"),
      );
      await expect(docs().find([1, column("id").value(1) as never])).rejects.toThrow(
        new TypeError("find() gives id a typed value; give the value itself"),
      );
    });
  });
});
