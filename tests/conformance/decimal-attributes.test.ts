import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { Model } from "../../packages/active-record/src/index.ts";
import { openHarness, type Harness } from "../support/harness.ts";

/** A value the property's type doesn't name, as one from a request would arrive. */
const untyped = (value: unknown) => value as never;

class Line extends Model.define({
  id: { type: "integer", null: false },
  label: "string",
  amount: "decimal",
}) {
  static table = "ledger_lines";
}

describe("decimal attributes", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.reset("ledger_lines");
  });

  const lines = () => harness.connect().model(Line);

  test("a decimal saved reads back as its text, without trailing zeros", async () => {
    const { id } = await lines().create({ amount: "12.50" });

    const { amount } = await lines().find(id);

    expect(amount).toBe("12.5");
  });

  describe("assigning", () => {
    test.each([
      ["decimal text", "12.50", "12.5"],
      ["text with a sign, spaces and an exponent", " +1.25e3 ", "1250"],
      ["text with a leading point", ".5", "0.5"],
      ["text with a trailing point", "5.", "5"],
      ["a negative zero", "-0.00", "0"],
      ["a number, at 16 significant digits", 0.1 + 0.2, "0.3"],
      ["a large number", 1e21, "1000000000000000000000"],
      ["a small number", 1e-7, "0.0000001"],
      ["a bigint", 12345678901234567890n, "12345678901234567890"],
      [
        "text past a number's precision",
        "12345678901234567890.123456789",
        "12345678901234567890.123456789",
      ],
    ])("%s is its decimal text", (_, value, expected) => {
      expect(Line.build({ amount: untyped(value) }).amount).toBe(expected);
    });

    test.each([
      ["text that isn't a number", "abc", '"abc"'],
      ["text with a number in it", "12abc", '"12abc"'],
      ["an empty string", "", '""'],
      ["NaN", Number.NaN, "NaN"],
      ["Infinity", Number.POSITIVE_INFINITY, "Infinity"],
      ["a boolean", true, "true"],
      ["an exponent past what Postgres holds", "1e200000", '"1e200000"'],
    ])("%s is a TypeError", (_, value, shown) => {
      expect(() => Line.build({ amount: untyped(value) })).toThrow(
        new TypeError(`Line: ${shown} isn't a decimal for "amount"`),
      );
    });
  });

  describe("change tracking", () => {
    test("the same number written another way isn't a change", async () => {
      const { id } = await lines().create({ amount: "1.5" });
      const line = await lines().find(id);

      line.amount = "1.50";

      expect(line.isChanged()).toBe(false);
    });
  });
});
