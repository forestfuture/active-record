import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { defineType, Model } from "../../packages/active-record/src/index.ts";
import { openHarness, type Harness } from "../support/harness.ts";

/** An amount of money, in cents. */
class Money {
  readonly cents: number;

  constructor(cents: number) {
    this.cents = cents;
  }
}

/** Money, kept as integer cents: a Money, or whole cents. */
const money = defineType({
  storedAs: "integer",
  cast(input) {
    if (input instanceof Money) return input;
    if (Number.isSafeInteger(input)) return new Money(input as number);
    throw new TypeError("not an amount of cents");
  },
  serialize: (value) => value.cents,
  deserialize: (cents) => new Money(cents),
});

class Listing extends Model.define({
  id: { type: "integer", null: false },
  title: "string",
  price: money,
}) {
  static table = "listings";
}

describe("custom types", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.reset("listings");
  });

  const listings = () => harness.connect().model(Listing);

  test("a value is stored as its type's stored value, and read back as the value", async () => {
    await listings().create({ id: 1, price: new Money(1250) });

    expect(await harness.exec("SELECT price FROM listings")).toEqual([{ price: 1250 }]);
    const { price } = await listings().find(1);
    expect(price).toBeInstanceOf(Money);
    expect(price?.cents).toBe(1250);
  });
});
