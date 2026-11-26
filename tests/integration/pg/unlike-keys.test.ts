import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { belongsTo, hasMany, Model } from "../../../packages/arbor/src/index.ts";
import { connect } from "../../../packages/arbor/src/adapters/postgresql/index.ts";
import { openPgSchema, type PgSchema } from "../../support/pg.ts";

const attributes = {
  id: { type: "integer", null: false },
  heldOn: "date",
  startsAt: "time",
  beginsAt: "datetime",
  isOpen: "boolean",
  name: "string",
} as const;

type EventKey = "heldOn" | "startsAt" | "beginsAt" | "isOpen";

/** An event Model whose tickets link to `key` from their text `code`. */
function modelsLinking(key: EventKey) {
  class Event extends Model.define(attributes) {
    static table = "events";

    tickets = hasMany(Ticket, { foreignKey: "code", primaryKey: key });
  }

  class Ticket extends Model.define({
    id: { type: "integer", null: false },
    code: "string",
    number: "integer",
  }) {
    static table = "tickets";

    event = belongsTo(Event, { foreignKey: "code", primaryKey: key });
  }

  return { Event, Ticket };
}

// Postgres compares a date, a time, a timestamp or a boolean with no text or number, so a key of
// another type linked to one matches nothing, rather than failing at Postgres (#586).
describe("a link to a key no text or number compares with", () => {
  let schema: PgSchema;
  const db = () => connect(schema.url);

  beforeAll(async () => {
    schema = await openPgSchema([
      new URL("../../fixtures/postgres/unlike-keys.sql", import.meta.url),
    ]);
    // Each ticket's code is the text of one of the event's keys, as Postgres writes it.
    await schema.pool.query({
      text:
        "INSERT INTO events VALUES (1, '2026-11-25', '09:30:00', '2026-11-25T09:30:00Z', true, 'fair');" +
        "INSERT INTO tickets VALUES (1, '2026-11-25', 1), (2, '09:30:00', 1)," +
        " (3, '2026-11-25 09:30:00+00', 1), (4, 'true', 1)",
    });
  });
  afterAll(() => schema.dispose());

  describe.each<EventKey>(["heldOn", "startsAt", "beginsAt", "isOpen"])(
    "from text to %s",
    (key) => {
      const { Event, Ticket } = modelsLinking(key);

      test("a belongsTo preload links no event", async () => {
        const tickets = await db().model(Ticket).includes("event").toArray();

        expect(tickets.map((ticket) => ticket.loaded("event") ?? null)).toEqual([
          null,
          null,
          null,
          null,
        ]);
      });

      test("a hasMany join finds no event", async () => {
        expect(await db().model(Event).joins("tickets").count()).toBe(0);
      });
    },
  );
});
