import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { lt, Model } from "../../packages/active-record/src/index.ts";
import { openHarness, type Harness } from "../support/harness.ts";

class Line extends Model.define({
  id: { type: "integer", null: false },
  label: "string",
  price: { type: "decimal", precision: 10, scale: 2 },
}) {
  static table = "ledger_lines";
}

// A decimal's precision and scale, as a NUMERIC(10, 2) column holds it (#398).
describe("a decimal's precision and scale", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.reset("ledger_lines");
  });

  const lines = () => harness.connect().model(Line);

  test("an assigned value is rounded to the scale, half away from zero", () => {
    const rounded = ["1.555", "-1.555", "9.995", "0.004", "2"].map(
      (price) => Line.build({ price }).price,
    );

    expect(rounded).toEqual(["1.56", "-1.56", "10", "0", "2"]);
  });

  test("an updated record holds the rounded value it saved", async () => {
    const line = await lines().create({ price: "1" });

    await line.update({ price: "2.345" });

    expect([line.price, (await lines().find(line.id)).price]).toEqual(["2.35", "2.35"]);
  });

  test("a value with more whole digits than the precision leaves is a TypeError", () => {
    expect(Line.build({ price: "99999999.99" }).price).toBe("99999999.99");
    expect(() => Line.build({ price: "123456789" })).toThrow(
      new TypeError('Line: "123456789" isn\'t a decimal for "price"'),
    );
  });

  test("rounding that carries past the precision is a TypeError", () => {
    expect(() => Line.build({ price: "99999999.995" })).toThrow(TypeError);
  });

  test("a precision without a scale rounds to whole numbers", () => {
    class Count extends Model.define({ id: "integer", n: { type: "decimal", precision: 3 } }) {}

    expect([Count.build({ n: "2.5" }).n, Count.build({ n: "-2.5" }).n]).toEqual(["3", "-3"]);
    expect(() => Count.build({ n: "999.5" })).toThrow(TypeError);
  });

  test("a condition's value is rounded the same way, so it finds what was stored", async () => {
    await lines().create({ label: "a", price: "1.555" });

    expect(await lines().where({ price: "1.5551" }).pluck("label")).toEqual(["a"]);
  });

  test("rounding a value up past a double's range is a TypeError, not a crash", () => {
    class Wide extends Model.define({ id: "integer", n: { type: "decimal", scale: 0 } }) {}
    // Half below where a double overflows (Number.MAX_VALUE and half its last place): rounding
    // it up reaches that place, past a double.
    const largest = `${BigInt(Number.MAX_VALUE) + 2n ** 970n - 1n}.5`;

    for (const value of [largest, `-${largest}`]) {
      expect(() => Wide.build({ n: value })).toThrow(/isn't a decimal for "n"/);
    }
  });

  test("a condition past the precision still compares: no stored value reaches it", async () => {
    await lines().create({ label: "a", price: "5" });

    expect(
      await lines()
        .where({ price: lt("1e9") })
        .pluck("label"),
    ).toEqual(["a"]);
  });
});
