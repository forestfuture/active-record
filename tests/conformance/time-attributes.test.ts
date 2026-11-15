import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { between, gt, Model } from "../../packages/active-record/src/index.ts";
import { openHarness, type Harness } from "../support/harness.ts";

/** A value the property's type doesn't name, as one from a request would arrive. */
const untyped = (value: unknown) => value as never;

class Line extends Model.define({
  id: { type: "integer", null: false },
  label: "string",
  startsAt: "time",
}) {
  static table = "ledger_lines";
}

describe("time attributes", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.reset("ledger_lines");
  });

  const lines = () => harness.connect().model(Line);

  test("a time saved reads back as its text, with seconds", async () => {
    const { id } = await lines().create({ startsAt: "09:30" });

    const { startsAt } = await lines().find(id);

    expect(startsAt).toBe("09:30:00");
  });

  describe("assigning", () => {
    test.each([
      ["hours and minutes", "09:30", "09:30:00"],
      ["seconds", "23:59:59", "23:59:59"],
      ["a fraction, without its trailing zeros", "09:30:15.250000", "09:30:15.25"],
      ["a fraction of zeros", "09:30:15.000", "09:30:15"],
    ])("%s is its time's text", (_, value, expected) => {
      expect(Line.build({ startsAt: value }).startsAt).toBe(expected);
    });

    test.each([
      [
        "a Date: its time depends on the time zone",
        new Date("2026-01-02T09:30:00Z"),
        '"2026-01-02T09:30:00.000Z"',
      ],
      ["a time with a zone", "09:30:00Z", '"09:30:00Z"'],
      ["an hour past the day", "24:00:00", '"24:00:00"'],
      ["a minute that doesn't exist", "09:60", '"09:60"'],
      ["an hour without two digits", "9:30", '"9:30"'],
      ["more than six digits of a fraction", "09:30:15.1234567", '"09:30:15.1234567"'],
      ["a number", 930, "930"],
    ])("%s is a TypeError", (_, value, shown) => {
      expect(() => Line.build({ startsAt: untyped(value) })).toThrow(
        new TypeError(`Line: ${shown} isn't a time for "startsAt"`),
      );
    });
  });

  test("a fraction saved reads back as written", async () => {
    const { id } = await lines().create({ startsAt: "09:30:15.123456" });

    const { startsAt } = await lines().find(id);

    expect(startsAt).toBe("09:30:15.123456");
  });

  describe("querying", () => {
    test("conditions, lists, comparisons and order compare times of day", async () => {
      await lines().insertAll([
        { label: "early", startsAt: "07:05" },
        { label: "noon", startsAt: "12:00" },
        { label: "late", startsAt: "21:45:30.5" },
      ]);

      const exactly = await lines().where({ startsAt: "12:00" }).pluck("label");
      const listed = await lines()
        .where({ startsAt: ["07:05:00", "21:45:30.50", untyped("never")] })
        .order({ startsAt: "desc" })
        .pluck("label");
      const after = await lines()
        .where({ startsAt: gt("07:05") })
        .order({ startsAt: "asc" })
        .pluck("label");
      const within = await lines()
        .where({ startsAt: between("07:00", "12:00") })
        .order({ startsAt: "asc" })
        .pluck("startsAt");

      expect(exactly).toEqual(["noon"]);
      expect(listed).toEqual(["late", "early"]);
      expect(after).toEqual(["noon", "late"]);
      expect(within).toEqual(["07:05:00", "12:00:00"]);
    });
  });

  test("typeForAttribute casts, serializes and reads a time", () => {
    const { cast, serialize, deserialize } = Line.typeForAttribute("startsAt");

    expect([cast("09:30"), serialize("10:00:00.10"), deserialize("11:15:00")]).toEqual([
      "09:30:00",
      "10:00:00.1",
      "11:15:00",
    ]);
  });
});
