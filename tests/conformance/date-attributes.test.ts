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
    const seed = async () => {
      await lines().insertAll([
        { label: "new year", bookedOn: "2026-01-01" },
        { label: "spring", bookedOn: "2026-03-20" },
        { label: "winter", bookedOn: "2026-12-21" },
      ]);
    };

    test("conditions, lists, comparisons and order compare days", async () => {
      await seed();

      const exactly = await lines().where({ bookedOn: "2026-03-20" }).pluck("label");
      const listed = await lines()
        .where({ bookedOn: ["2026-01-01", "2026-12-21", untyped("never")] })
        .order({ bookedOn: "desc" })
        .pluck("label");
      const after = await lines()
        .where({ bookedOn: gt("2026-01-01") })
        .order({ bookedOn: "asc" })
        .pluck("label");
      const within = await lines()
        .where({ bookedOn: between("2026-01-01", "2026-06-30") })
        .order({ bookedOn: "asc" })
        .pluck("bookedOn");

      expect(exactly).toEqual(["spring"]);
      expect(listed).toEqual(["winter", "new year"]);
      expect(after).toEqual(["spring", "winter"]);
      expect(within).toEqual(["2026-01-01", "2026-03-20"]);
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
