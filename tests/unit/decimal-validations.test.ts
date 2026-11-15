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

class Order extends Model.define({
  id: { type: "integer", null: false },
  total: "decimal",
  limit: "decimal",
}) {
  static table = "orders";

  static {
    this.validates("total", {
      comparison: { greaterThan: "9", lessThan: 1000, lessThanOrEqualTo: (order) => order.limit },
    });
  }
}

const orders = connect({} as never).model(Order);

async function orderErrorsFor(total: string, limit: string | null = null) {
  const order = orders.build({ total, limit });
  await order.isValid();
  return order.errors.toArray().map(({ type, message }) => `${type}: ${message}`);
}

// comparison compares a decimal's text as a number, exactly, as numericality does (#391).
describe("comparison on a decimal", () => {
  test("text and number bounds compare as numbers, not as text", async () => {
    expect(await orderErrorsFor("10")).toEqual([]);
    expect(await orderErrorsFor("8.5")).toEqual(["greaterThan: must be greater than 9"]);
    expect(await orderErrorsFor("1000.01")).toEqual(["lessThan: must be less than 1000"]);
  });

  test("a bound from the record compares as a number", async () => {
    expect(await orderErrorsFor("100", "99.5")).toEqual([
      "lessThanOrEqualTo: must be less than or equal to 99.5",
    ]);
    expect(await orderErrorsFor("99.5", "100")).toEqual([]);
  });

  test.each([
    ["text that isn't a decimal", "abc", "a string that isn't a decimal"],
    ["a Date", new Date(0), "a Date"],
  ])("a bound that's %s throws TypeError", async (_, bound, described) => {
    class Sample extends Model.define({ id: "integer", total: "decimal" }) {
      static table = "samples";
      static {
        this.validates("total", { comparison: { greaterThan: bound } });
      }
    }
    const sample = connect({} as never)
      .model(Sample)
      .build({ total: "1" });

    await expect(sample.isValid()).rejects.toThrow(
      new TypeError(`Sample: "total" (a decimal) can't be compared with ${described}`),
    );
  });
});

// A bound of NaN or Infinity orders against a decimal as it does against a number (#391).
describe("a decimal against a bound of NaN or Infinity", () => {
  async function failures(rules: Record<string, unknown>, total = "5") {
    class Sample extends Model.define({ id: "integer", total: "decimal" }) {
      static table = "samples";
      static {
        this.validates("total", rules as never);
      }
    }
    const sample = connect({} as never)
      .model(Sample)
      .build({ total });
    await sample.isValid();
    return sample.errors.toArray().map(({ type }) => type);
  }

  test("against NaN, only comparison's otherThan holds", async () => {
    expect(await failures({ comparison: { otherThan: Number.NaN } })).toEqual([]);
    expect(await failures({ comparison: { greaterThan: Number.NaN } })).toEqual(["greaterThan"]);
  });

  test("numericality's Infinity bound holds for every decimal", async () => {
    expect(await failures({ numericality: { lessThan: Number.POSITIVE_INFINITY } })).toEqual([]);
  });

  test("comparison's Infinity bound is beyond every decimal", async () => {
    expect(await failures({ comparison: { greaterThan: Number.POSITIVE_INFINITY } })).toEqual([
      "greaterThan",
    ]);
  });

  test("Number.MAX_VALUE bounds a decimal as a number, in numericality and comparison", async () => {
    expect(await failures({ numericality: { lessThanOrEqualTo: Number.MAX_VALUE } })).toEqual([]);
    expect(await failures({ comparison: { lessThan: Number.MAX_VALUE } })).toEqual([]);
  });
});
