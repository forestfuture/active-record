import { describe, expect, test } from "vite-plus/test";
import {
  belongsTo,
  defineType,
  hasMany,
  InvalidModel,
  Model,
} from "../../packages/arbor/src/index.ts";
import { connect } from "../../packages/arbor/src/adapters/d1/index.ts";

// No D1 needed: these checks happen when a Model is first used.
const db = connect({} as never);

/** A day kept as a date, as its text: a custom type stored as one, which links as a date. */
const day = defineType({
  storedAs: "date",
  cast: (input) => String(input),
  serialize: (text) => text,
  deserialize: (text) => text,
});

class Event extends Model.define({
  id: { type: "integer", null: false },
  code: "string",
  token: "uuid",
  ratio: "real",
  amount: { type: "decimal", precision: 10, scale: 2 },
  heldOn: "date",
  opensAt: "time",
  bytes: "binary",
  startsAt: "datetime",
  stamp: { type: "datetime", storage: "unixSeconds" },
  isOpen: "boolean",
  data: "json",
  day: { type: day, column: "held_on" },
}) {
  static table = "events";
}

/** `type` with its article: an integer, a uuid. */
const article = (type: string) => `${/^[aeio]/.test(type) ? "an" : "a"} ${type}`;

/** A Model whose foreign key `key`, of `type`, points at Event's attribute `primaryKey`. */
function ticketFor(type: string, primaryKey: string) {
  return class Ticket extends Model.define({
    id: { type: "integer", null: false },
    key: type as "string",
  }) {
    static table = "tickets";

    event = belongsTo(Event, { foreignKey: "key", primaryKey, optional: true });
  };
}

// A link mixes key types only between text and an integer or a uuid; any other pair is refused
// when the Model is first used (#596).
describe("the key types a link may join", () => {
  test.each([
    ["string", "code"],
    ["string", "id"],
    ["string", "token"],
    ["string", "stamp"],
    ["integer", "code"],
    ["uuid", "code"],
    ["integer", "ratio"],
    ["decimal", "id"],
    ["date", "heldOn"],
    ["date", "day"],
    ["json", "data"],
  ])("a foreign key of type %s may link to %s", (type, primaryKey) => {
    expect(() => db.model(ticketFor(type, primaryKey))).not.toThrow();
  });

  test.each([
    ["string", "ratio", "real"],
    ["string", "amount", "decimal"],
    ["string", "heldOn", "date"],
    ["string", "startsAt", "datetime"],
    ["string", "isOpen", "boolean"],
    ["string", "data", "json"],
    ["string", "day", "date"],
    ["string", "opensAt", "time"],
    ["string", "bytes", "binary"],
    ["integer", "token", "uuid"],
    ["uuid", "id", "integer"],
    ["date", "startsAt", "datetime"],
    ["real", "code", "string"],
  ])("a foreign key of type %s can't link to %s", (type, primaryKey, keyType) => {
    expect(() => db.model(ticketFor(type, primaryKey))).toThrow(
      new InvalidModel(
        `Ticket association "event" links Ticket.key, stored as ${article(type)}, to Event.${primaryKey}, stored as ${article(keyType)}, which can't be compared; declare key as Event.${primaryKey} is declared`,
      ),
    );
  });

  test("a datetime kept as a Unix time can't link to one kept as text", () => {
    class Mark extends Model.define({
      id: { type: "integer", null: false },
      iso: "datetime",
      seconds: { type: "datetime", storage: "unixSeconds" },
    }) {
      static table = "marks";

      bySeconds = belongsTo(Mark, { foreignKey: "iso", primaryKey: "seconds", optional: true });
    }

    expect(() => db.model(Mark)).toThrow(
      new InvalidModel(
        `Mark association "bySeconds" links Mark.iso, stored as a datetime, to Mark.seconds, stored as an integer, which can't be compared; declare iso as Mark.seconds is declared`,
      ),
    );
  });

  test("a polymorphic belongsTo checks each listed Model's key", () => {
    class Venue extends Model.define({ id: { type: "integer", null: false }, heldOn: "date" }) {
      static table = "venues";
    }
    class Booking extends Model.define({
      id: { type: "integer", null: false },
      bookableType: "string",
      bookableId: "string",
    }) {
      static table = "bookings";

      bookable = belongsTo([Event, Venue], { primaryKey: "heldOn", optional: true });
    }

    expect(() => db.model(Booking)).toThrow(
      new InvalidModel(
        `Booking association "bookable" links Booking.bookableId, stored as a string, to Event.heldOn, stored as a date, which can't be compared; declare bookableId as Event.heldOn is declared`,
      ),
    );
  });

  test("a hasMany names its target's foreign key to declare", () => {
    class Owner extends Model.define({ id: { type: "integer", null: false }, heldOn: "date" }) {
      static table = "owners";

      tickets = hasMany(ticketFor("string", "code"), { foreignKey: "key", primaryKey: "heldOn" });
    }

    expect(() => db.model(Owner)).toThrow(
      new InvalidModel(
        `Owner association "tickets" links Owner.heldOn, stored as a date, to Ticket.key, stored as a string, which can't be compared; declare key as Owner.heldOn is declared`,
      ),
    );
  });
});
