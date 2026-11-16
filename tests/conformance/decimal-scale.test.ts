import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { Model } from "../../packages/active-record/src/index.ts";
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
});
