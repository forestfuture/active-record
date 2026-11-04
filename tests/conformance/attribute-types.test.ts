import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { Model, sql } from "../../src/index.ts";
import { openHarness, type Harness } from "../support/harness.ts";

class Sample extends Model.define({
  id: { type: "integer", null: false },
  label: "string",
  quantity: "integer",
  ratio: "real",
  enabled: "boolean",
  stamp: "datetime",
  settings: "json",
}) {
  static table = "samples";
}

class JsonValue extends Model.define({
  id: { type: "integer", null: false },
  checked: "json", // TEXT CHECK (json_valid(checked)), as D1 recommends
  value: "json", // declared JSON
}) {
  static table = "json_values";
}

describe("attribute types", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.reset("samples", "json_values");
  });

  test("each type reads back from D1 as its JavaScript value", async () => {
    await harness.exec(`INSERT INTO samples (id, label, quantity, ratio, enabled, stamp, settings)
         VALUES (1, 'hello', 42, 0.5, 1, '2026-01-02T03:04:05.000Z', '{"theme":"dark","sizes":[1,2]}')`);

    const [sample] = await harness.connect().model(Sample).toArray();

    expect(sample?.label).toBe("hello");
    expect(sample?.quantity).toBe(42);
    expect(sample?.ratio).toBe(0.5);
    expect(sample?.enabled).toBe(true);
    expect(sample?.stamp).toEqual(new Date(Date.UTC(2026, 0, 2, 3, 4, 5)));
    expect(sample?.settings).toEqual({ theme: "dark", sizes: [1, 2] });
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
    const records = harness.connect().model(JsonValue);
    for (const [index, value] of jsonValues.entries()) {
      await records.create({ id: index + 1, checked: value, value });
    }
    return records;
  }

  test("a json column is queried by value or by list, whichever way it's declared", async () => {
    const records = await writeJsonValues();

    for (const column of ["checked", "value"] as const) {
      expect(await records.where({ [column]: 123 }).pluck("id")).toEqual([1]);
      expect(await records.where({ [column]: "123" }).pluck("id")).toEqual([7]);
      expect(await records.where({ [column]: { a: 1 } }).pluck("id")).toEqual([13]);
      expect(await records.where({ [column]: [123, "abc"] }).pluck("id")).toEqual([1, 9]);
    }
  });

  test("NULL reads back as null for every type", async () => {
    await harness.exec("INSERT INTO samples (id) VALUES (1)");

    const [sample] = await harness.connect().model(Sample).toArray();

    expect([
      sample?.label,
      sample?.quantity,
      sample?.ratio,
      sample?.enabled,
      sample?.stamp,
      sample?.settings,
    ]).toEqual([null, null, null, null, null, null]);
  });

  test("where converts values to their stored form", async () => {
    await harness.exec(`INSERT INTO samples (id, enabled, stamp) VALUES
           (1, 1, '2026-01-02T03:04:05.000Z'),
           (2, 0, '2026-06-07T08:09:10.000Z')`);
    const samples = harness.connect().model(Sample);

    const enabled = await samples.where({ enabled: true }).toArray();
    const stamped = await samples
      .where({ stamp: new Date(Date.UTC(2026, 5, 7, 8, 9, 10)) })
      .toArray();

    expect(enabled.map((sample) => sample.id)).toEqual([1]);
    expect(stamped.map((sample) => sample.id)).toEqual([2]);
  });

  test("where with null matches rows whose column is NULL", async () => {
    await harness.exec("INSERT INTO samples (id, label) VALUES (1, 'set'), (2, NULL)");

    const unlabeled = await harness.connect().model(Sample).where({ label: null }).toArray();

    expect(unlabeled.map((sample) => sample.id)).toEqual([2]);
  });

  test("booleans and dates interpolated into an sql fragment are bound in their stored form", async () => {
    await harness.exec(`INSERT INTO samples (id, enabled, stamp) VALUES
           (1, 1, '2026-01-02T03:04:05.000Z'),
           (2, 0, '2026-01-02T03:04:05.000Z')`);
    const stamp = new Date(Date.UTC(2026, 0, 2, 3, 4, 5));

    const samples = await harness
      .connect()
      .model(Sample)
      .where(sql`enabled = ${true} AND stamp = ${stamp}`)
      .toArray();

    expect(samples.map((sample) => sample.id)).toEqual([1]);
  });

  test("toJSON gives the attributes with dates as ISO strings, so Response.json works", async () => {
    await harness.exec(`INSERT INTO samples (id, label, enabled, stamp, settings)
         VALUES (1, 'hello', 1, '2026-01-02T03:04:05.000Z', '{"theme":"dark"}')`);
    const samples = harness.connect().model(Sample);
    const [sample] = await samples.toArray();
    const [partial] = await samples.select("stamp").toArray();

    expect(JSON.parse(JSON.stringify(sample))).toEqual({
      id: 1,
      label: "hello",
      quantity: null,
      ratio: null,
      enabled: true,
      stamp: "2026-01-02T03:04:05.000Z",
      settings: { theme: "dark" },
    });
    expect(await Response.json(partial).json()).toEqual({
      id: 1,
      stamp: "2026-01-02T03:04:05.000Z",
    });
  });
});
