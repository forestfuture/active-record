import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { belongsTo, hasMany, Model } from "../../packages/arbor/src/index.ts";
import type { QueryEvent } from "../../packages/arbor/src/executor.ts";
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

  const events: QueryEvent[] = [];
  const db = () => harness.connect({ onQuery: (event) => events.push(event) });
  beforeEach(async () => {
    events.length = 0;
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

  test("an integer key reads the record whose Unix time it is", async () => {
    const booking = await db().model(Booking).find(2);

    expect((await booking.slot())?.name).toBe("b");
  });

  test("a Unix time preloads the records whose integer key it is", async () => {
    const slots = await db().model(Slot).includes("bookings").order({ id: "asc" }).toArray();
    const sent = events.length;

    const labels = await Promise.all(
      slots.map(async (each) => (await each.bookings().toArray()).map((booking) => booking.label)),
    );
    expect(labels).toEqual([["first"], ["second"]]);
    expect(events).toHaveLength(sent);
  });

  test("a Unix time reads the records whose integer key it is", async () => {
    const slot = await db().model(Slot).find(2);

    expect((await slot.bookings().toArray()).map((booking) => booking.label)).toEqual(["second"]);
  });

  test("a record built, created or pushed through a Unix time takes its integer", async () => {
    const slot = await db().model(Slot).find(2);
    const pushed = await db().model(Booking).create({ id: 3, label: "pushed" });

    const built = slot.bookings().build({ id: 4, label: "built" });
    const created = await slot.bookings().create({ id: 5, label: "created" });
    await slot.bookings().push(pushed);

    expect([built.quantity, created.quantity, pushed.quantity]).toEqual([120, 120, 120]);
    expect(await db().model(Booking).where({ quantity: 120 }).count()).toBe(3);
  });

  test("a record pointed at a Unix time takes its integer", async () => {
    const booking = await db().model(Booking).find(1);

    booking.slot.set(await db().model(Slot).find(2));
    await booking.save();

    expect(booking.quantity).toBe(120);
    expect((await db().model(Booking).find(1)).quantity).toBe(120);
  });
});
