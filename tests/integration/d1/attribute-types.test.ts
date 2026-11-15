import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { Model } from "../../../packages/active-record/src/index.ts";
import { connect } from "../../../packages/active-record/src/adapters/d1/index.ts";
import { createTestDatabase, type TestDatabase } from "../../support/d1.ts";

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

class Amount extends Model.define({ id: { type: "integer", null: false }, value: "decimal" }) {
  static table = "amounts";
}

// SQLite keeps decimal text in a DECIMAL column as a REAL or an INTEGER (#391).
describe("decimal attributes on D1", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;
  const amounts = () => connect(binding).model(Amount);

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
    await binding.exec("CREATE TABLE amounts (id INTEGER PRIMARY KEY, value DECIMAL)");
  });
  afterAll(() => dispose());

  test("a decimal keeps about 15 significant digits", async () => {
    const { id } = await amounts().create({ value: "1.2345678901234567891" });

    const { value } = await amounts().find(id);

    expect(value).toBe("1.234567890123457");
  });

  test("a whole number past a safe integer saves, and reads rounded as any decimal is", async () => {
    const { id } = await amounts().create({ value: "12345678901234567890" });

    const { value } = await amounts().find(id);

    expect(value).toBe("12345678901234570000");
  });
});
