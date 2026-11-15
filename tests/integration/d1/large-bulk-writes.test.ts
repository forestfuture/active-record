import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { Model } from "../../../packages/active-record/src/index.ts";
import { connect, type QueryEvent } from "../../../packages/active-record/src/adapters/d1/index.ts";
import { createTestDatabase, type TestDatabase } from "../../support/d1.ts";

// Bulk writes whose rows, bound as one JSON value, would pass D1's 2,000,000-byte cap on a value
// (#392). Miniflare doesn't enforce the cap, so these count the statements; tests/remote shows
// real D1 taking them.
class Attachment extends Model.define({
  id: { type: "integer", null: false },
  name: "string",
  data: "binary",
  digest: "binary",
}) {
  static table = "attachments";
}

const schema = new URL("../../fixtures/sqlite/conformance.sql", import.meta.url);

/** `size` bytes, each `fill`: 300,000 of them are 600,000 bytes of hex in a bulk write's JSON. */
const bytes = (size: number, fill: number) => new Uint8Array(size).fill(fill);

/** Five rows of 300,000 bytes: about 3 MB of JSON, two statements' worth. */
const largeRows = () =>
  [1, 2, 3, 4, 5].map((id) => ({ id, name: `file ${id}`, data: bytes(300_000, id) }));

// Megabytes through Miniflare take seconds under coverage, or beside other suites.
describe("bulk writes past D1's cap on one value", { timeout: 20_000 }, () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;
  let events: QueryEvent[];

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase(schema));
  });
  afterAll(() => dispose());
  beforeEach(async () => {
    await binding.prepare("DELETE FROM attachments").run();
    events = [];
  });

  const db = () => connect(binding, { onQuery: (event) => events.push(event) });
  const inserts = () => events.filter(({ sql }) => sql.startsWith("INSERT"));

  test("insertAll sends its rows as several statements, and every row lands", async () => {
    const result = await db().model(Attachment).insertAll(largeRows());

    expect(inserts()).toHaveLength(2);
    expect(result.rowsAffected).toBe(5);
    expect(result.rows.map(({ id }) => id).toSorted((a, b) => a! - b!)).toEqual([1, 2, 3, 4, 5]);
    expect(await stored()).toEqual([1, 2, 3, 4, 5].map((id) => [id, 300_000, id]));
  });

  // [[1,"…"],[2,"…"]] is 15 bytes around the names; the first name is 1,000,000 bytes of UTF-8,
  // in two-, three- and four-byte characters, so the cap is counted in bytes, not characters.
  test.each([
    [999_985, 1],
    [999_986, 2],
  ])("with a second name of %i bytes, the rows take %i statements", async (size, statements) => {
    const multibyte = "é".repeat(200_000) + "€".repeat(100_000) + "😀".repeat(75_000);

    await db()
      .model(Attachment)
      .insertAll([
        { id: 1, name: multibyte },
        { id: 2, name: "b".repeat(size) },
      ]);

    expect(inserts()).toHaveLength(statements);
    const names = await db().model(Attachment).order({ id: "asc" }).pluck("name");
    expect(names).toEqual([multibyte, "b".repeat(size)]);
  });

  test("a duplicate in the last statement writes none of the rows", async () => {
    await db().model(Attachment).insert({ id: 5, name: "taken" });
    events = [];

    await expect(db().model(Attachment).insertAll(largeRows())).rejects.toThrow();

    expect(inserts()).toHaveLength(2);
    expect(await stored()).toEqual([[5, 0, undefined]]);
  });

  test("in db.batch, the statements are one entry's result", async () => {
    const results = await db().batch((b) => [
      b.insertAll(Attachment, largeRows()),
      b.insert(Attachment, { id: 6, name: "small" }),
    ]);

    expect(inserts()).toHaveLength(3);
    expect(results.map(({ rowsAffected }) => rowsAffected)).toEqual([5, 1]);
    expect(results[0].rows).toHaveLength(5);
  });

  test("in db.batch, the statements are written with the other entries or not at all", async () => {
    const failing = db().batch((b) => [
      b.insertAll(Attachment, largeRows()),
      b.insert(Attachment, { id: 1, name: "duplicate" }),
    ]);

    await expect(failing).rejects.toThrow();
    expect(await stored()).toEqual([]);
  });

  // Text, which Miniflare moves faster than bytes; the conformance suite writes a large row of bytes.
  test("a row whose JSON alone passes the cap binds its values apart, through insertAll and upsert", async () => {
    const large = "x".repeat(2_000_000);

    await db()
      .model(Attachment)
      .insertAll([
        { id: 1, name: "small" },
        { id: 2, name: large },
      ]);
    await db().model(Attachment).upsert({ id: 1, name: large });

    // One JSON value for the small row; the large row's id and name each bound apart.
    expect(inserts().map(({ params }) => params.length)).toEqual([1, 2, 2]);
    const names = await db().model(Attachment).order({ id: "asc" }).pluck("name");
    expect(names.map((name) => name?.length)).toEqual([2_000_000, 2_000_000]);
  });

  test("listeners see a filtered attribute hidden in every statement", async () => {
    class Secret extends Attachment {
      static override filterAttributes = ["digest"];
    }
    const rows = largeRows().map((row) => ({ ...row, digest: bytes(4, 7) }));

    await db().model(Secret).insertAll(rows);

    const shown = inserts().map(({ params }) => JSON.parse(params[0] as string) as unknown[][]);
    expect(shown).toHaveLength(2);
    expect(shown.flat().map((row) => row.at(-1))).toEqual(Array(5).fill("[FILTERED]"));
  });

  test("listeners see a filtered attribute hidden in a row bound apart", async () => {
    class Secret extends Attachment {
      static override filterAttributes = ["name"];
    }

    await db()
      .model(Secret)
      .insertAll([{ id: 1, name: "x".repeat(2_000_000) }]);

    expect(inserts().map(({ params }) => params)).toEqual([[1, "[FILTERED]"]]);
  });

  /** Each stored row's id, and its bytes' length and first byte. */
  async function stored() {
    const records = await db().model(Attachment).order({ id: "asc" }).toArray();
    return records.map(({ id, data }) => [id, data?.length ?? 0, data?.[0]]);
  }
});
