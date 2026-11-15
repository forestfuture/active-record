import { describe, expect, test } from "vite-plus/test";
import { Model } from "../../packages/active-record/src/index.ts";
import { connect } from "../../packages/active-record/src/adapters/d1/index.ts";

class Price extends Model.define({
  id: { type: "integer", null: false },
  amount: "decimal",
  units: "decimal",
  label: "string",
}) {
  static table = "prices";

  static {
    this.validates("amount", { numericality: { greaterThan: 0, lessThanOrEqualTo: 9.99 } });
    this.validates("units", { numericality: { onlyInteger: true }, allowNull: true });
    this.validates("label", { numericality: true, allowNull: true });
  }
}

const prices = connect({} as never).model(Price);

async function errorsFor(attributes: { amount: string; units?: string; label?: string }) {
  const price = prices.build(attributes);
  await price.isValid();
  return price.errors
    .toArray()
    .map(({ attribute, type, message }) => `${attribute} ${type}: ${message}`);
}

// A decimal holds text, compared exactly with numericality's bounds (#391).
describe("numericality on a decimal", () => {
  test("a decimal within its bounds is valid", async () => {
    expect(await errorsFor({ amount: "9.99" })).toEqual([]);
  });

  test("bounds compare decimals as numbers, exactly", async () => {
    expect(await errorsFor({ amount: "10" })).toEqual([
      "amount lessThanOrEqualTo: must be less than or equal to 9.99",
    ]);
    expect(await errorsFor({ amount: "9.990000000000000000001" })).toEqual([
      "amount lessThanOrEqualTo: must be less than or equal to 9.99",
    ]);
    expect(await errorsFor({ amount: "-0.5" })).toEqual([
      "amount greaterThan: must be greater than 0",
    ]);
  });

  test("onlyInteger refuses a decimal with a fraction", async () => {
    expect(await errorsFor({ amount: "1", units: "2.5" })).toEqual([
      "units notAnInteger: must be an integer",
    ]);
    expect(await errorsFor({ amount: "1", units: "200" })).toEqual([]);
  });

  test("a string attribute's digits are still not a number", async () => {
    expect(await errorsFor({ amount: "1", label: "12" })).toEqual([
      "label notANumber: is not a number",
    ]);
  });
});
