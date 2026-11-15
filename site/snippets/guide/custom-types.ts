import { defineType, gte, Model } from "@forestfuture/active-record";
import { ApplicationRecord } from "./application-record";

// #region money
export class Money {
  readonly cents: number;

  constructor(cents: number) {
    this.cents = cents;
  }

  toString() {
    return `$${(this.cents / 100).toFixed(2)}`;
  }
}

export const money = defineType({
  storedAs: "integer",
  cast(input) {
    if (input instanceof Money) return input;
    if (Number.isSafeInteger(input)) return new Money(input as number);
    throw new TypeError("money is a Money or a whole number of cents");
  },
  serialize: (value) => value.cents,
  deserialize: (cents) => new Money(cents),
});
// #endregion money

// #region override
export class Product extends ApplicationRecord {
  static override attributes = {
    priceCents: money,
  } as const;
}
// #endregion override

// #region declare
export class Invoice extends Model.define({
  id: { type: "integer", null: false },
  total: { type: money, null: false },
}) {}
// #endregion declare

export async function pricedProducts() {
  // #region query
  const cheap = await Product.where({ priceCents: new Money(500) }).toArray();
  const pricey = await Product.where({ priceCents: gte(new Money(10_000)) })
    .order({ priceCents: "desc" })
    .toArray();
  // #endregion query
  return { cheap, pricey };
}

// #region sizes
export const sizes = defineType({
  storedAs: "string",
  cast(input) {
    if (Array.isArray(input) && input.every((size) => typeof size === "string")) {
      return input as string[];
    }
    throw new TypeError("sizes are a list of strings");
  },
  serialize: (list) => list.join(","),
  deserialize: (text) => (text === "" ? [] : text.split(",")),
});
// #endregion sizes

export class Shirt extends Model.define({
  id: { type: "integer", null: false },
  sizes: { type: sizes, null: false, default: () => [] },
}) {}

export function addSize(shirt: Shirt) {
  // #region in-place
  shirt.sizes.push("XL");
  shirt.isChanged(); // true
  // #endregion in-place
}
