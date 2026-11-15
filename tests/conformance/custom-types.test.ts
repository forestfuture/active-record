import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { defineType, gt, Model } from "../../packages/active-record/src/index.ts";
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
  deserialize(cents) {
    if (cents < 0) throw new RangeError("a price can't be negative");
    return new Money(cents);
  },
});

/** A list of sizes, kept as text: `"S,M,L"`. */
const sizeList = defineType({
  storedAs: "string",
  cast(input) {
    if (Array.isArray(input) && input.every((each) => typeof each === "string")) {
      return input as string[];
    }
    throw new TypeError("not a list of sizes");
  },
  serialize: (sizes) => sizes.join(","),
  deserialize: (text) => (text === "" ? [] : text.split(",")),
});

class Listing extends Model.define({
  id: { type: "integer", null: false },
  title: "string",
  price: money,
  sizes: { type: sizeList, null: false, default: () => [] },
}) {
  static table = "listings";
}

// The same price, filtered (#83): its values, and its type's errors, stay out of messages.
class SecretListing extends Listing {
  static override filterAttributes = ["price"];
}

/** A type whose serialize gives text, which its stored type, integer, can't hold. */
const broken = defineType({
  storedAs: "integer",
  cast: (input: unknown) => input as number,
  serialize: () => "five" as unknown as number,
  deserialize: (stored) => stored,
});

class BrokenListing extends Model.define({
  id: { type: "integer", null: false },
  price: broken,
}) {
  static table = "listings";
}

/** What a function throws. */
function thrown(run: () => unknown): unknown {
  try {
    run();
  } catch (error) {
    return error;
  }
  throw new Error("expected it to throw");
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

  describe("refusing", () => {
    test("a value its cast throws for is a TypeError, the type's error its cause", () => {
      const error = thrown(() => Listing.build({ price: "abc" as never }));

      expect(error).toEqual(new TypeError('Listing: "abc" isn\'t a valid value for "price"'));
      expect((error as Error).cause).toEqual(new TypeError("not an amount of cents"));
    });

    test("permit refuses it the same way", () => {
      expect(() => Listing.permit({ price: "abc" }, "price")).toThrow(
        new TypeError('Listing: "abc" isn\'t a valid value for "price"'),
      );
    });

    test("a cell its deserialize throws for fails the load, the type's error its cause", async () => {
      await harness.exec("INSERT INTO listings (id, price) VALUES (1, -5)");

      const error = await listings()
        .find(1)
        .catch((caught: unknown) => caught);

      expect(error).toEqual(new TypeError('Listing: -5 isn\'t a valid value for "price"'));
      expect((error as Error).cause).toEqual(new RangeError("a price can't be negative"));
    });

    // A guard: NULL is null before any type reads it.
    test("a NULL cell is null, never given to deserialize", async () => {
      await harness.exec("INSERT INTO listings (id, price) VALUES (1, NULL)");

      expect((await listings().find(1)).price).toBeNull();
    });

    test("a serialize that gives what its stored type can't hold fails the save", async () => {
      const record = harness.connect().model(BrokenListing).build({ id: 1, price: 5 });

      const error = await record.save().catch((caught: unknown) => caught);

      expect(error).toEqual(new TypeError('BrokenListing: 5 isn\'t a valid value for "price"'));
      expect(await harness.exec("SELECT id FROM listings")).toEqual([]);
    });

    test("a filtered attribute's refusal shows neither its value nor its type's error", () => {
      const error = thrown(() => SecretListing.build({ price: "abc" as never }));

      expect(error).toEqual(
        new TypeError('SecretListing: [FILTERED] isn\'t a valid value for "price"'),
      );
      expect((error as Error).cause).toBeUndefined();
    });
  });

  describe("change tracking", () => {
    test("assigning an equal value in another object isn't a change", async () => {
      await listings().create({ id: 1, price: new Money(500), sizes: ["S"] });
      const listing = await listings().find(1);

      listing.price = new Money(500);
      listing.sizes = ["S"];

      expect(listing.isChanged()).toBe(false);
    });

    test("a change's from or to that the type can't hold matches nothing, as a condition's value", async () => {
      await listings().create({ id: 1, price: new Money(500) });
      const listing = await listings().find(1);

      listing.price = new Money(700);

      expect(listing.isAttributeChanged("price", { from: new Money(500) })).toBe(true);
      expect(listing.isAttributeChanged("price", { from: "abc" as never })).toBe(false);
      expect(listing.isAttributeChanged("price", { to: "abc" as never })).toBe(false);
    });

    test("a value changed in place is a change, and saving writes it", async () => {
      await listings().create({ id: 1, sizes: ["S"] });
      const listing = await listings().find(1);

      listing.sizes.push("M");

      expect(listing.changes()).toEqual({ sizes: [["S"], ["S", "M"]] });
      await listing.save();
      expect(await harness.exec("SELECT sizes FROM listings")).toEqual([{ sizes: "S,M" }]);
    });
  });

  describe("conditions and bulk writes", () => {
    beforeEach(async () => {
      await listings().insertAll([
        { id: 1, title: "a", price: new Money(500) },
        { id: 2, title: "b", price: new Money(1500) },
        { id: 3, title: "c", price: new Money(250) },
      ]);
    });

    const titles = (relation: ReturnType<typeof listings>) =>
      relation.order({ id: "asc" }).pluck("title");

    test("where takes a value, anything its cast takes, or a list", async () => {
      expect(await titles(listings().where({ price: new Money(500) }))).toEqual(["a"]);
      expect(await titles(listings().where({ price: 1500 as never }))).toEqual(["b"]);
      expect(await titles(listings().where({ price: [new Money(250), new Money(500)] }))).toEqual([
        "a",
        "c",
      ]);
    });

    test("a value its cast throws for matches nothing", async () => {
      expect(
        await listings()
          .where({ price: "abc" as never })
          .count(),
      ).toBe(0);
    });

    test("values compare and order as their stored values do", async () => {
      expect(await titles(listings().where({ price: gt(new Money(300)) }))).toEqual(["a", "b"]);
      expect(await listings().order({ price: "desc" }).pluck("title")).toEqual(["b", "a", "c"]);
    });

    test("pluck reads values as a load does", async () => {
      const prices = await listings().order({ id: "asc" }).pluck("price");

      expect(prices.map((price) => price?.cents)).toEqual([500, 1500, 250]);
    });

    test("updateAll writes a value as its stored value", async () => {
      await listings()
        .where({ id: 3 })
        .updateAll({ price: new Money(900) });

      expect(await harness.exec("SELECT price FROM listings WHERE id = 3")).toEqual([
        { price: 900 },
      ]);
    });
  });

  describe("typeForAttribute", () => {
    const { cast, serialize, deserialize } = Listing.typeForAttribute("price");

    test("its conversions are the type's, through its stored type", () => {
      expect(cast(1250)).toEqual(new Money(1250));
      expect(serialize(new Money(1250))).toBe(1250);
      expect(serialize(1250)).toBe(1250);
      expect(deserialize(1250)).toEqual(new Money(1250));
    });

    test("each refuses as a record does, the type's error the cause", () => {
      expect(() => cast("abc")).toThrow(
        new TypeError('Listing: "abc" isn\'t a valid value for "price"'),
      );
      expect(() => deserialize(-5)).toThrow(
        new TypeError('Listing: -5 isn\'t a valid value for "price"'),
      );
      expect(() => deserialize("abc")).toThrow(
        new TypeError('Listing: "abc" isn\'t a valid value for "price"'),
      );
    });
  });
});
