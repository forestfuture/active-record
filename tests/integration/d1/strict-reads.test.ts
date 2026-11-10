import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { hasMany, Model } from "../../../packages/active-record/src/index.ts";
import { connect } from "../../../packages/active-record/src/adapters/d1/index.ts";
import { createTestDatabase, type TestDatabase } from "../../support/d1.ts";

class Reading extends Model.define({
  id: { type: "integer", null: false },
  ownerId: "integer",
  label: "string",
  quantity: "integer",
  ratio: "real",
  enabled: "boolean",
  stamp: "datetime",
  seconds: { type: "datetime", storage: "unixSeconds" },
  milliseconds: { type: "datetime", storage: "unixMilliseconds" },
  settings: "json",
  secret: "integer",
}) {
  static table = "strict_reads";
  static override filterAttributes = ["secret"];
}

class Owner extends Model.define({ id: { type: "integer", null: false } }) {
  static table = "strict_owners";

  readings = hasMany(Reading, { foreignKey: "ownerId" });
}

describe("a stored cell that isn't the attribute's type fails when it's read (#159)", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
    // No declared types, so SQLite keeps each value as it was bound: no column affinity converts.
    await binding.batch([
      binding.prepare(
        "CREATE TABLE strict_reads (id INTEGER PRIMARY KEY, owner_id, label, quantity, ratio, enabled, stamp, seconds, milliseconds, settings, secret)",
      ),
      binding.prepare("CREATE TABLE strict_owners (id INTEGER PRIMARY KEY)"),
    ]);
  });
  afterAll(() => dispose());
  beforeEach(async () => {
    await binding.batch([
      binding.prepare("DELETE FROM strict_reads"),
      binding.prepare("DELETE FROM strict_owners"),
    ]);
  });

  const readings = () => connect(binding).model(Reading);
  const insertCell = (column: string, cell: unknown, id = 1) =>
    binding.prepare(`INSERT INTO strict_reads (id, ${column}) VALUES (?, ?)`).bind(id, cell).run();

  const refused = [
    ["enabled", 2, "2 isn't a boolean"],
    ["enabled", "1", `"1" isn't a boolean`],
    ["enabled", "true", `"true" isn't a boolean`],
    ["quantity", 1.5, "1.5 isn't an integer"],
    ["quantity", "abc", `"abc" isn't an integer`],
    ["quantity", "42", `"42" isn't an integer`],
    ["quantity", Number.MAX_SAFE_INTEGER + 1, "9007199254740992 isn't an integer"],
    ["ratio", "abc", `"abc" isn't a real`],
    ["label", 5, "5 isn't a string"],
    ["stamp", "garbage", `"garbage" isn't a datetime`],
    ["stamp", "12", `"12" isn't a datetime`],
    ["stamp", "2026-02-30 03:04:05", `"2026-02-30 03:04:05" isn't a datetime`],
    ["stamp", 1767323045, "1767323045 isn't a datetime"],
    ["seconds", "abc", `"abc" isn't a datetime`],
    ["stamp", "+002026-01-01T00:00:00.000Z", `"+002026-01-01T00:00:00.000Z" isn't a datetime`],
    ["stamp", "+010000-02-30T00:00:00.000Z", `"+010000-02-30T00:00:00.000Z" isn't a datetime`],
    [
      "stamp",
      "2026-01-02T03:04:05.1234567890Z",
      `"2026-01-02T03:04:05.1234567890Z" isn't a datetime`,
    ],
    ["seconds", "", `"" isn't a datetime`],
    ["milliseconds", "abc", `"abc" isn't a datetime`],
    ["settings", "not json {", `"not json {" isn't a JSON value`],
    ["seconds", "1767323045", `"1767323045" isn't a datetime`],
  ] as const;

  describe.each(refused)("%s holding %j", (column, cell, shown) => {
    const error = new TypeError(`Reading: ${shown} for "${column}"`);

    test("fails find, naming the Model and attribute", async () => {
      await insertCell(column, cell);

      await expect(readings().find(1)).rejects.toThrow(error);
    });

    test("fails a list whole, and pluck, as a load does", async () => {
      await insertCell("label", "fine", 1);
      await insertCell(column, cell, 2);

      await expect(readings().toArray()).rejects.toThrow(error);
      await expect(readings().pluck(column)).rejects.toThrow(error);
    });
  });

  test("fails reload when the cell changed to one that can't be read", async () => {
    await insertCell("enabled", 1);
    const reading = await readings().find(1);
    await binding.prepare("UPDATE strict_reads SET enabled = 2 WHERE id = 1").run();

    await expect(reading.reload()).rejects.toThrow(
      new TypeError(`Reading: 2 isn't a boolean for "enabled"`),
    );
  });

  test("fails a preload of the records that hold it", async () => {
    await binding.prepare("INSERT INTO strict_owners (id) VALUES (1)").run();
    await binding
      .prepare("INSERT INTO strict_reads (id, owner_id, enabled) VALUES (1, 1, 2)")
      .run();

    await expect(connect(binding).model(Owner).includes("readings").find(1)).rejects.toThrow(
      new TypeError(`Reading: 2 isn't a boolean for "enabled"`),
    );
  });

  test("hides a filtered attribute's cell, by find and by pluck", async () => {
    await insertCell("secret", "hunter2");
    const error = new TypeError(`Reading: [FILTERED] isn't an integer for "secret"`);

    await expect(readings().find(1)).rejects.toThrow(error);
    await expect(readings().pluck("secret")).rejects.toThrow(error);
  });

  describe("reads a cell that is a value of the type", () => {
    test("NULL as null, for every attribute", async () => {
      await binding.prepare("INSERT INTO strict_reads (id) VALUES (1)").run();

      const reading = await readings().find(1);

      expect(reading.attributes()).toMatchObject({
        label: null,
        quantity: null,
        ratio: null,
        enabled: null,
        stamp: null,
        seconds: null,
        milliseconds: null,
        settings: null,
      });
    });

    test("0 and 1 as booleans, whole and negative integers, and a real that is whole", async () => {
      await binding
        .prepare(
          "INSERT INTO strict_reads (id, label, quantity, ratio, enabled) VALUES (1, 'a', 7, 3, 0), (2, 'b', -7, 1.5, 1), (3, 'c', 0, -0.5, 1)",
        )
        .run();

      const rows = await readings().order({ id: "asc" }).toArray();

      expect(rows.map((row) => [row.label, row.quantity, row.ratio, row.enabled])).toEqual([
        ["a", 7, 3, false],
        ["b", -7, 1.5, true],
        ["c", 0, -0.5, true],
      ]);
    });

    test.each([
      ["2026-01-02T03:04:05.678Z", "2026-01-02T03:04:05.678Z"],
      ["2026-01-02T05:04:05+02:00", "2026-01-02T03:04:05.000Z"],
      ["2026-01-02 03:04:05", "2026-01-02T03:04:05.000Z"],
      ["2026-01-02", "2026-01-02T00:00:00.000Z"],
    ])("an ISO datetime held as %s", async (cell, iso) => {
      await insertCell("stamp", cell);

      expect((await readings().find(1)).stamp).toEqual(new Date(iso));
    });

    test("a Unix time, whole or fractional", async () => {
      await insertCell("seconds", 1767323045.5);

      expect((await readings().find(1)).seconds).toEqual(new Date(1767323045500));
    });

    test("a Unix time in milliseconds, and JSON of any shape", async () => {
      await binding
        .prepare(
          "INSERT INTO strict_reads (id, milliseconds, settings) VALUES (1, 1767323045678, '[1,{\"a\":null}]')",
        )
        .run();

      const reading = await readings().find(1);

      expect(reading.milliseconds).toEqual(new Date(1767323045678));
      expect(reading.settings).toEqual([1, { a: null }]);
    });

    test.each([["+010000-01-01T00:00:00.000Z"], ["-000001-12-31T23:59:59.999Z"]])(
      "a far year held as %s, as a save writes it",
      async (cell) => {
        await insertCell("stamp", cell);

        expect((await readings().find(1)).stamp).toEqual(new Date(cell));
      },
    );

    test("a date past year 9999 after a save, a reload, and a save of another attribute", async () => {
      const far = new Date("+010000-01-01T00:00:00.000Z");
      const reading = await readings().create({ id: 1, stamp: far });

      reading.label = "after";
      await reading.save();

      expect(reading.stamp).toEqual(far);
      expect((await reading.reload()).stamp).toEqual(far);
    });

    test("a record's own snapshot, after a save that changed another attribute", async () => {
      await readings().create({
        id: 1,
        stamp: new Date("2026-01-02T03:04:05.678Z"),
        enabled: true,
      });
      const reading = await readings().find(1);

      reading.quantity = 3;
      await reading.save();

      expect(reading.changes()).toEqual({});
      expect(reading.enabled).toBe(true);
    });
  });
});
