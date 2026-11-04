import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { Model } from "../../packages/active-record/src/index.ts";
import { connect } from "../../packages/d1-record/src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

class JsonValue extends Model.define({
  id: { type: "integer", null: false },
  checked: "json", // TEXT CHECK (json_valid(checked)), as D1 recommends
  value: "json", // declared JSON
}) {
  static table = "json_values";
}

describe("attribute types", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
  });
  afterAll(() => dispose());
  beforeEach(async () => {
    await binding.batch([
      binding.prepare("DELETE FROM samples"),
      binding.prepare("DELETE FROM json_values"),
    ]);
  });

  // Every kind of JSON value, numbers written as text included.
  const jsonValues: unknown[] = [
    123,
    1.5,
    -7,
    0,
    0.1 + 0.2,
    1e21,
    "123",
    "  42 ",
    "abc",
    true,
    false,
    null,
    { a: 1 },
    [1, "2"],
  ];

  async function writeJsonValues() {
    const records = connect(binding).model(JsonValue);
    for (const [index, value] of jsonValues.entries()) {
      await records.create({ id: index + 1, checked: value, value });
    }
    return records;
  }

  test("json reads back as written, from a TEXT column and from one declared JSON", async () => {
    const records = await writeJsonValues();

    // Declared JSON, the column has numeric affinity: SQLite stores 123 as a number.
    const stored = await binding
      .prepare(
        "SELECT typeof(checked) AS text, typeof(value) AS json FROM json_values WHERE id = 1",
      )
      .first<{ text: string; json: string }>();

    expect(stored).toEqual({ text: "text", json: "integer" });
    expect(await records.order({ id: "asc" }).pluck("checked")).toEqual(jsonValues);
    expect(await records.order({ id: "asc" }).pluck("value")).toEqual(jsonValues);
  });
});
