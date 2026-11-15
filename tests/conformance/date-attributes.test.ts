import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { between, gt, Model } from "../../packages/active-record/src/index.ts";
import { openHarness, type Harness } from "../support/harness.ts";

/** A value the property's type doesn't name, as one from a request would arrive. */
const untyped = (value: unknown) => value as never;

class Line extends Model.define({
  id: { type: "integer", null: false },
  label: "string",
  bookedOn: "date",
}) {
  static table = "ledger_lines";
}

describe("date attributes", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.reset("ledger_lines");
  });

  const lines = () => harness.connect().model(Line);

  test("a date saved reads back as its day's text", async () => {
    const { id } = await lines().create({ bookedOn: "2026-01-02" });

    const { bookedOn } = await lines().find(id);

    expect(bookedOn).toBe("2026-01-02");
  });

  describe("assigning", () => {
    test.each([
      [
        "a Date: its day depends on the time zone",
        new Date("2026-01-02T00:00:00Z"),
        '"2026-01-02T00:00:00.000Z"',
      ],
      ["a date and time", "2026-01-02T10:00:00Z", '"2026-01-02T10:00:00Z"'],
      ["a day that doesn't exist", "2026-02-30", '"2026-02-30"'],
      ["a month that doesn't exist", "2026-13-01", '"2026-13-01"'],
      ["year 0, which Postgres has no day in", "0000-01-01", '"0000-01-01"'],
      ["text with spaces", " 2026-01-02", '" 2026-01-02"'],
      ["a number", 20260102, "20260102"],
    ])("%s is a TypeError", (_, value, shown) => {
      expect(() => Line.build({ bookedOn: untyped(value) })).toThrow(
        new TypeError(`Line: ${shown} isn't a date for "bookedOn"`),
      );
    });

    test("a leap day is a date in a leap year", () => {
      expect(Line.build({ bookedOn: "2028-02-29" }).bookedOn).toBe("2028-02-29");
      expect(() => Line.build({ bookedOn: "2026-02-29" })).toThrow(TypeError);
    });
  });

  describe("querying", () => {
    beforeEach(async () => {
      await lines().insertAll([
        { label: "new year", bookedOn: "2026-01-01" },
        { label: "spring", bookedOn: "2026-03-20" },
        { label: "winter", bookedOn: "2026-12-21" },
      ]);
    });

    test("a condition finds the day", async () => {
      expect(await lines().where({ bookedOn: "2026-03-20" }).pluck("label")).toEqual(["spring"]);
    });

    test("a list finds each day, and leaves out text that isn't one", async () => {
      const listed = lines().where({ bookedOn: ["2026-01-01", "2026-12-21", untyped("never")] });

      expect(await listed.order({ bookedOn: "desc" }).pluck("label")).toEqual([
        "winter",
        "new year",
      ]);
    });

    test("comparisons and order follow the calendar", async () => {
      const within = lines().where({ bookedOn: between("2026-01-01", "2026-06-30") });

      expect(await within.order({ bookedOn: "asc" }).pluck("bookedOn")).toEqual([
        "2026-01-01",
        "2026-03-20",
      ]);
    });

    test("gt finds the later days", async () => {
      const after = lines().where({ bookedOn: gt("2026-01-01") });

      expect(await after.order({ bookedOn: "asc" }).pluck("label")).toEqual(["spring", "winter"]);
    });
  });

  test("typeForAttribute casts, serializes and reads a date", () => {
    const { cast, serialize, deserialize } = Line.typeForAttribute("bookedOn");

    expect([cast("2026-01-02"), serialize("2026-01-03"), deserialize("2026-01-04")]).toEqual([
      "2026-01-02",
      "2026-01-03",
      "2026-01-04",
    ]);
  });
});
