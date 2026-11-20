import { defineType } from "@forestfuture/active-record";

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
