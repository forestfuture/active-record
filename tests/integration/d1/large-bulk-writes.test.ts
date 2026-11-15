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

describe("bulk writes past D1's cap on one value", () => {
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

  test("a duplicate in the last statement writes none of the rows", async () => {
    await db().model(Attachment).insert({ id: 5, name: "taken" });
    events = [];

    await expect(db().model(Attachment).insertAll(largeRows())).rejects.toThrow();

    expect(inserts()).toHaveLength(2);
    expect(await stored()).toEqual([[5, 0, undefined]]);
  });

  test("in db.batch, the statements are one entry's result, written with the others or not at all", async () => {
    const results = await db().batch((b) => [
      b.insertAll(Attachment, largeRows()),
      b.insert(Attachment, { id: 6, name: "small" }),
    ]);

    expect(inserts()).toHaveLength(3);
    expect(results.map(({ rowsAffected }) => rowsAffected)).toEqual([5, 1]);
    expect(results[0].rows).toHaveLength(5);

    await binding.prepare("DELETE FROM attachments").run();
    const failing = db().batch((b) => [
      b.insertAll(Attachment, largeRows()),
      b.insert(Attachment, { id: 1, name: "duplicate" }),
    ]);
    await expect(failing).rejects.toThrow();
    expect(await stored()).toEqual([]);
  });

  test("a row whose JSON alone passes the cap binds its values apart, through insertAll and upsert", async () => {
    const large = bytes(1_500_000, 9);

    await db()
      .model(Attachment)
      .insertAll([
        { id: 1, name: "small", data: bytes(3, 1) },
        { id: 2, name: "large", data: large },
      ]);
    await db().model(Attachment).upsert({ id: 1, name: "replaced", data: large });

    const sent = inserts().map(({ sql, params }) => [sql.includes("VALUES"), params.length]);
    expect(sent).toEqual([
      [false, 1],
      [true, 3],
      [true, 3],
    ]);
    expect(await stored()).toEqual([
      [1, 1_500_000, 9],
      [2, 1_500_000, 9],
    ]);
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

  /** Each stored row's id, and its bytes' length and first byte. */
  async function stored() {
    const records = await db().model(Attachment).order({ id: "asc" }).toArray();
    return records.map(({ id, data }) => [id, data?.length ?? 0, data?.[0]]);
  }
});
