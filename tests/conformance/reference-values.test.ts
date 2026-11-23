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
const unwrapped = (method: string, given: string) =>
  new TypeError(
    `${method}() gives ${given} a column() or incoming() reference; write it in an sql\`…\` fragment`,
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
        unwrapped("updateAll", "settings"),
      );
      await expect(docs().updateAll({ folderId: column("id") as never })).rejects.toThrow(
        unwrapped("updateAll", "folderId"),
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
        unwrapped("updateAll", "settings"),
      );
      expect(await stored()).toEqual(before);
    });
  });

  describe("a condition refuses it, where it matched nothing or the reference's JSON", () => {
    test("as the value, a list's item, or a comparison's value", () => {
      expect(() => docs().where({ folderId: column("id") as never })).toThrow(
        unwrapped("where", "folderId"),
      );
      expect(() => docs().where({ folderId: [1, column("id") as never] })).toThrow(
        unwrapped("where", "folderId"),
      );
      expect(() => docs().where({ folderId: gte(column("id") as never) })).toThrow(
        unwrapped("where", "folderId"),
      );
      expect(() => docs().where({ folderId: column("id").value(1) as never })).toThrow(
        new TypeError("where() gives folderId a typed value; give the value itself"),
      );
    });

    test("in whereNot, rewhere, and findBy and findOrCreateBy, which say where()", async () => {
      expect(() => docs().whereNot({ settings: column("id") as never })).toThrow(
        unwrapped("whereNot", "settings"),
      );
      expect(() => docs().rewhere({ settings: incoming("id") as never })).toThrow(
        unwrapped("rewhere", "settings"),
      );
      await expect(docs().findBy({ settings: column("id") as never })).rejects.toThrow(
        unwrapped("where", "settings"),
      );
      await expect(docs().findOrCreateBy({ settings: column("id") as never })).rejects.toThrow(
        unwrapped("where", "settings"),
      );
      expect(await stored()).toHaveLength(1);
    });
  });
});
