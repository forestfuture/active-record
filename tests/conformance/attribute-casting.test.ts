import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { belongsTo, between, gte, Model, RecordNotFound } from "../../src/index.ts";
import type { QueryEvent } from "../../src/executor.ts";
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

class ApiKey extends Model.define({ id: { type: "string", null: false }, label: "string" }) {
  static table = "api_keys";
}

// A foreign key whose type differs from the key it points at: an integer holding a text key.
class KeyedSample extends Model.define({
  id: { type: "integer", null: false },
  quantity: "integer",
}) {
  static table = "samples";

  apiKey = belongsTo(ApiKey, { foreignKey: "quantity" });
}

/** A value as the error shows it: JSON, with numbers as written (`NaN`, `Infinity`). */
const shown = (value: unknown) =>
  typeof value === "number" ? String(value) : JSON.stringify(value);

/** Assigns a value no TypeScript type allows, as JSON, a form or a query string can (#81). */
const untyped = (value: unknown) => value as never;

describe("values assigned to attributes are cast to the attribute's type (#81)", () => {
  let harness: Harness;
  const samples = () => harness.connect().model(Sample);

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.reset("samples", "api_keys");
  });

  /** Saves `value` as the attribute, and what it reads as before saving and after reloading. */
  async function roundTrip(attribute: keyof Sample & string, value: unknown) {
    const sample = samples().build({ [attribute]: untyped(value) });
    const assigned = sample[attribute];
    await sample.saveOrThrow();
    const reloaded = await samples().find(sample.id);
    return [assigned, reloaded[attribute]];
  }

  describe("boolean", () => {
    test.each([
      [true, true],
      [false, false],
      [1, true],
      [0, false],
      ["1", true],
      ["0", false],
      ["true", true],
      ["false", false],
      ["TRUE", true],
      ["False", false],
      ["on", true],
      ["off", false],
    ])("%j is %j", async (value, expected) => {
      expect(await roundTrip("enabled", value)).toEqual([expected, expected]);
    });

    test.each([["no"], ["yes"], ["t"], ["f"], [""], [" true"], [2], [-1], [{}], [[]]])(
      "%j is refused",
      (value: unknown) => {
        expect(() => samples().build({ enabled: untyped(value) })).toThrow(
          new TypeError(`Sample: ${shown(value)} isn't a boolean for "enabled"`),
        );
      },
    );

    // The value comes from outside, so its error (often logged) shows only the start of it.
    test("an error shows at most 60 characters of the value", () => {
      expect(() => samples().build({ enabled: untyped("x".repeat(10_000)) })).toThrow(
        new TypeError(`Sample: "${"x".repeat(59)}… isn't a boolean for "enabled"`),
      );
    });

    test("a setter casts as it assigns, and refuses without changing the attribute", () => {
      const sample = samples().build({ enabled: true });

      sample.enabled = untyped("false");
      expect(sample.enabled).toBe(false);
      expect(() => (sample.enabled = untyped("no"))).toThrow(TypeError);
      expect(sample.enabled).toBe(false);
    });

    test("assign, update and create cast too", async () => {
      const created = await samples().create({ enabled: untyped("false") });
      expect(created.enabled).toBe(false);

      created.assign({ enabled: untyped("on") });
      expect(created.enabled).toBe(true);

      await created.update({ enabled: untyped("0") });
      expect((await samples().find(created.id)).enabled).toBe(false);
    });

    test("null is still NULL", async () => {
      expect(await roundTrip("enabled", null)).toEqual([null, null]);
    });
  });

  describe("integer", () => {
    test.each([
      [42, 42],
      [-7, -7],
      [0, 0],
      ["42", 42],
      [" 42 ", 42],
      ["-7", -7],
      ["+3", 3],
      [Number.MAX_SAFE_INTEGER, Number.MAX_SAFE_INTEGER],
    ])("%j is %j", async (value, expected) => {
      expect(await roundTrip("quantity", value)).toEqual([expected, expected]);
    });

    test.each([
      [1.7],
      ["12abc"],
      ["1 OR 1=1"],
      ["1e3"],
      ["1.0"],
      [""],
      [" "],
      [Number.NaN],
      [Number.POSITIVE_INFINITY],
      [Number.MAX_SAFE_INTEGER + 1],
      [true],
      [{}],
    ])("%j is refused", (value: unknown) => {
      expect(() => samples().build({ quantity: untyped(value) })).toThrow(
        new TypeError(`Sample: ${shown(value)} isn't an integer for "quantity"`),
      );
    });
  });

  describe("string", () => {
    test.each([["hello"], [""], [" spaced "], ["42"]])("%j is kept", async (value) => {
      expect(await roundTrip("label", value)).toEqual([value, value]);
    });

    test.each([[5], [true], [{ a: 1 }], [["a"]], [new Date(0)]])(
      "%j is refused",
      (value: unknown) => {
        expect(() => samples().build({ label: untyped(value) })).toThrow(
          new TypeError(`Sample: ${shown(value)} isn't a string for "label"`),
        );
      },
    );
  });

  describe("datetime", () => {
    const at = (iso: string) => new Date(iso);

    test.each([
      [at("2026-01-02T03:04:05.678Z"), at("2026-01-02T03:04:05.678Z")],
      ["2026-01-02", at("2026-01-02T00:00:00.000Z")],
      ["2026-01-02T03:04:05Z", at("2026-01-02T03:04:05.000Z")],
      ["2026-01-02T03:04:05.678Z", at("2026-01-02T03:04:05.678Z")],
      ["2026-01-02T03:04Z", at("2026-01-02T03:04:00.000Z")],
      ["2026-01-02T05:04:05+02:00", at("2026-01-02T03:04:05.000Z")],
      ["2026-01-02 03:04:05-01:30", at("2026-01-02T04:34:05.000Z")],
    ])("%j is %j", async (value, expected) => {
      expect(await roundTrip("stamp", value)).toEqual([expected, expected]);
    });

    test.each([
      [new Date(Number.NaN)],
      ["2026-01-02T03:04:05"], // no offset: whose 3am?
      ["2026-02-30"],
      ["2026-02-30T10:00:00Z"], // Date would roll it over to 2 March
      ["2026-02-29T10:00:00+02:00"],
      ["2026-01-02T03:04:05+0530"], // offsets are ±HH:MM
      ["2026-01-02t03:04:05z"],
      ["2026-13-01"],
      ["02/01/2026"],
      ["Jan 2, 2026"],
      ["not a date"],
      [""],
      [1_767_225_600_000],
      [true],
    ])("%j is refused", (value: unknown) => {
      const text = value instanceof Date ? "Invalid Date" : shown(value);
      expect(() => samples().build({ stamp: untyped(value) })).toThrow(
        new TypeError(`Sample: ${text} isn't a datetime for "stamp"`),
      );
    });
  });

  describe("real", () => {
    test.each([
      [0.5, 0.5],
      [3, 3],
      ["1.5", 1.5],
      [" -2.25 ", -2.25],
      ["-2e3", -2000],
      [".5", 0.5],
      ["5.", 5],
      ["42", 42],
    ])("%j is %j", async (value, expected) => {
      expect(await roundTrip("ratio", value)).toEqual([expected, expected]);
    });

    test.each([["1.5x"], ["0x10"], [""], ["."], [Number.NaN], [Number.NEGATIVE_INFINITY], [false]])(
      "%j is refused",
      (value: unknown) => {
        expect(() => samples().build({ ratio: untyped(value) })).toThrow(
          new TypeError(`Sample: ${shown(value)} isn't a real for "ratio"`),
        );
      },
    );

    // A pattern that backtracks would take seconds on this, and a request body can hold it (ReDoS).
    test("a long string that isn't a number is refused in linear time", () => {
      for (const attribute of ["ratio", "quantity"] as const) {
        const started = performance.now();
        expect(() => samples().build({ [attribute]: untyped(`${"1".repeat(100_000)}x`) })).toThrow(
          TypeError,
        );
        expect(performance.now() - started).toBeLessThan(100);
      }
    });
  });

  // Bulk writes have no record: they cast what they're given, as a record casts what it's assigned.
  describe("bulk writes", () => {
    const enabled = async () =>
      (await samples().order({ id: "asc" }).pluck("enabled")) as unknown[];

    test("insert, insertAll, upsert and upsertAll cast each value", async () => {
      await samples().insert({ id: 1, enabled: untyped("false") });
      await samples().insertAll([{ id: 2, enabled: untyped("on") }]);
      await samples().upsert({ id: 1, enabled: untyped("1") }, { uniqueBy: "id" });
      await samples().upsertAll([{ id: 3, enabled: untyped("0") }], { uniqueBy: "id" });

      expect(await enabled()).toEqual([true, true, false]);
    });

    test("updateAll casts each change", async () => {
      await samples().insertAll([
        { id: 1, enabled: true },
        { id: 2, enabled: true },
      ]);

      expect(
        await samples().updateAll({ enabled: untyped("false"), quantity: untyped(" 3 ") }),
      ).toBe(2);
      expect(await samples().pluck("quantity")).toEqual([3, 3]);
      expect(await enabled()).toEqual([false, false]);
    });

    test("a value that can't be cast is a TypeError, and nothing is written", async () => {
      const error = new TypeError(`Sample: "no" isn't a boolean for "enabled"`);

      await expect(samples().insert({ id: 1, enabled: untyped("no") })).rejects.toThrow(error);
      expect(() => samples().toInsertAll([{ id: 1, enabled: untyped("no") }])).toThrow(error);
      expect(() => samples().toUpsert({ id: 1, enabled: untyped("no") })).toThrow(error);
      expect(() => samples().toUpdateAll({ enabled: untyped("no") })).toThrow(error);
      expect(await samples().count()).toBe(0);
    });
  });

  // A condition's value is cast as an assigned one is; one that can't be cast matches nothing,
  // as in Rails 6.1+, so it's never a NULL match or an error (#81).
  describe("conditions", () => {
    beforeEach(async () => {
      await samples().insertAll([
        { id: 1, quantity: 1, enabled: true, stamp: new Date("2026-01-02T00:00:00.000Z") },
        { id: 2, quantity: 2, enabled: false, stamp: null },
        { id: 3, quantity: null, enabled: null, stamp: null },
      ]);
    });
    const ids = (relation: { pluck(name: "id"): Promise<number[]> }) => relation.pluck("id");

    test("are cast to the attribute's type", async () => {
      expect(await ids(samples().where({ quantity: untyped("2") }))).toEqual([2]);
      expect(await ids(samples().where({ enabled: untyped("false") }))).toEqual([2]);
      expect(await ids(samples().where({ stamp: untyped("2026-01-02") }))).toEqual([1]);
      expect((await samples().findBy({ quantity: untyped(" 1 ") }))?.id).toBe(1);
      expect(await samples().exists({ enabled: untyped("on") })).toBe(true);
    });

    test("a value that can't be cast matches nothing, not even NULL", async () => {
      expect(
        await samples()
          .where({ quantity: untyped("abc") })
          .count(),
      ).toBe(0);
      expect(
        await samples()
          .where({ enabled: untyped("no") })
          .count(),
      ).toBe(0);
      expect(
        await samples()
          .where({ label: untyped({ a: 1 }) })
          .count(),
      ).toBe(0);
      expect(await samples().findBy({ quantity: untyped("1 OR 1=1") })).toBeNull();
      expect(await samples().exists({ stamp: untyped("yesterday") })).toBe(false);
    });

    // NOT of "matches nothing" is "matches everything", as in Rails 6.1+: excluding a record by
    // an untrusted id that can't be cast excludes nothing.
    test("whereNot with a value that can't be cast matches every row, NULLs included", async () => {
      expect(
        await samples()
          .whereNot({ quantity: untyped("abc") })
          .count(),
      ).toBe(3);
    });

    // A number can't be mistaken for anything else, so a condition reads it as its digits, as
    // find() does for a text key, and as Rails does. Assigning one to a string is still refused.
    test("a number matches a string attribute as its decimal string", async () => {
      await samples().insert({ id: 4, label: "7" });

      expect(await ids(samples().where({ label: untyped(7) }))).toEqual([4]);
      expect(
        await samples()
          .where({ label: untyped(Number.NaN) })
          .count(),
      ).toBe(0);
      expect(
        await samples()
          .where({ label: untyped(true) })
          .count(),
      ).toBe(0);
    });

    test("a list keeps the values that can be cast, and NULL", async () => {
      expect(
        await ids(
          samples()
            .where({ quantity: untyped(["1", "x", 2]) })
            .order({ id: "asc" }),
        ),
      ).toEqual([1, 2]);
      expect(await ids(samples().where({ quantity: untyped(["x", null]) }))).toEqual([3]);
      expect(
        await samples()
          .where({ quantity: untyped(["x"]) })
          .count(),
      ).toBe(0);
    });

    test("comparisons are cast, and match nothing when they can't be", async () => {
      expect(await ids(samples().where({ quantity: gte(untyped("2")) }))).toEqual([2]);
      expect(
        await samples()
          .where({ quantity: gte(untyped("two")) })
          .count(),
      ).toBe(0);
      expect(
        await samples()
          .where({ quantity: between(untyped("1"), untyped("x")) })
          .count(),
      ).toBe(0);
    });

    test("find and findByOrThrow throw RecordNotFound for a value that can't be cast", async () => {
      expect((await samples().find(untyped("2"))).id).toBe(2);
      await expect(samples().find(untyped("abc"))).rejects.toThrow(RecordNotFound);
      await expect(samples().find(untyped(["1", "abc"]))).rejects.toThrow(RecordNotFound);
      await expect(samples().findByOrThrow({ quantity: untyped("abc") })).rejects.toThrow(
        RecordNotFound,
      );
    });
  });

  test("an association set through a foreign key of another type stays loaded", async () => {
    const events: QueryEvent[] = [];
    const db = harness.connect({ onQuery: (event) => events.push(event) });
    const key = db.model(ApiKey).build({ id: "7", label: "deploy" });
    const sample = db.model(KeyedSample).build({ id: 1 });

    sample.apiKey.set(key);

    expect(sample.quantity).toBe(7);
    expect(await sample.apiKey()).toBe(key);
    expect(events).toEqual([]);
  });

  test("an association loads through a foreign key of another type", async () => {
    const db = harness.connect();
    await db.model(ApiKey).insert({ id: "7", label: "deploy" });
    await db.model(KeyedSample).insert({ id: 1, quantity: 7 });

    const sample = await db.model(KeyedSample).find(1);

    expect((await sample.apiKey())?.label).toBe("deploy");
  });
});
