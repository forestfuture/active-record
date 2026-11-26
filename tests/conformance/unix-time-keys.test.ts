import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { belongsTo, hasMany, Model } from "../../packages/arbor/src/index.ts";
import { openHarness, type Harness } from "../support/harness.ts";

// A slot's start, kept as a Unix time, is the key its bookings' integer `quantity` links to.
class Slot extends Model.define({
  id: { type: "integer", null: false },
  name: "string",
  seconds: { type: "datetime", storage: "unixSeconds" },
  milliseconds: { type: "datetime", storage: "unixMilliseconds" },
}) {
  static table = "stamps";

  bookings = hasMany(Booking, { foreignKey: "quantity", primaryKey: "seconds" });
}

class Booking extends Model.define({
  id: { type: "integer", null: false },
  label: "string",
  quantity: "integer",
}) {
  static table = "samples";

  slot = belongsTo(Slot, { foreignKey: "quantity", primaryKey: "seconds", optional: true });
}

// A datetime kept as a Unix time links as the integer it stores, in a preload and a lazy read
// as in a join (#592).
describe("a key linked to a Unix time", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());

  const db = () => harness.connect();
  beforeEach(async () => {
    await harness.reset("stamps", "samples");
    await harness.exec(
      "INSERT INTO stamps (id, name, seconds, milliseconds) VALUES (1, 'a', 60, 60)",
    );
    await harness.exec(
      "INSERT INTO stamps (id, name, seconds, milliseconds) VALUES (2, 'b', 120, 1)",
    );
    await harness.exec("INSERT INTO samples (id, label, quantity) VALUES (1, 'first', 60)");
    await harness.exec("INSERT INTO samples (id, label, quantity) VALUES (2, 'second', 120)");
  });

  test("an integer key preloads the record whose Unix time it is", async () => {
    const bookings = await db().model(Booking).includes("slot").order({ id: "asc" }).toArray();

    expect(await Promise.all(bookings.map(async (each) => (await each.slot())?.name))).toEqual([
      "a",
      "b",
    ]);
  });
});
