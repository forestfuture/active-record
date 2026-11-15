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
    expect(result.rows.map(({ id }) => id).toSorted()).toEqual([1, 2, 3, 4, 5]);
    const stored = await db().model(Attachment).order({ id: "asc" }).toArray();
    expect(stored.map(({ data }) => [data!.length, data![0]])).toEqual(
      [1, 2, 3, 4, 5].map((id) => [300_000, id]),
    );
  });
});
