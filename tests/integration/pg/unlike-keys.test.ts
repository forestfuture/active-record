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
type TicketKey = "code" | "number" | "isOpen" | "heldOn";

/** An event Model whose tickets link to its `key` from their `foreignKey`. */
function modelsLinking(foreignKey: TicketKey, key: EventKey) {
  class Event extends Model.define(attributes) {
    static table = "events";

    tickets = hasMany(Ticket, { foreignKey, primaryKey: key });
  }

  class Ticket extends Model.define({
    id: { type: "integer", null: false },
    code: "string",
    number: "integer",
    isOpen: "boolean",
    heldOn: "date",
  }) {
    static table = "tickets";

    event = belongsTo(Event, { foreignKey, primaryKey: key });
    siblings = hasMany(Ticket, { through: "event", source: "tickets" });
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
    // Each ticket's code is the text of one of the event's keys, as Postgres writes it, and its
    // other keys hold what a key of their type would match: the event begins at midnight in the
    // session's zone, the instant Postgres would compare the ticket's date as.
    await schema.pool.query({
      text:
        "INSERT INTO events VALUES (1, '2026-11-25', '09:30:00', '2026-11-25', true, 'fair');" +
        "INSERT INTO tickets VALUES (1, '2026-11-25', 1, true, '2026-11-25')," +
        " (2, '09:30:00', 1, true, '2026-11-25'), (3, '2026-11-25 00:00:00+00', 1, true, '2026-11-25')," +
        " (4, 'true', 1, true, '2026-11-25')",
    });
  });
  afterAll(() => schema.dispose());

  describe.each<[TicketKey, EventKey]>([
    ["code", "heldOn"],
    ["code", "startsAt"],
    ["code", "beginsAt"],
    ["code", "isOpen"],
    ["number", "heldOn"],
    ["number", "startsAt"],
    ["number", "beginsAt"],
    ["number", "isOpen"],
    ["isOpen", "heldOn"],
    ["heldOn", "beginsAt"],
  ])("from %s to %s", (foreignKey, key) => {
    const { Event, Ticket } = modelsLinking(foreignKey, key);

    test("a belongsTo preload links no event", async () => {
      const tickets = await db().model(Ticket).includes("event").toArray();

      expect(tickets.map((ticket) => ticket.loaded("event") ?? null)).toEqual([
        null,
        null,
        null,
        null,
      ]);
    });

    test("a hasMany preload links no ticket", async () => {
      const [event] = await db().model(Event).includes("tickets").toArray();

      expect(event!.loaded("tickets")).toEqual([]);
    });

    test("a hasMany join finds no event", async () => {
      expect(await db().model(Event).joins("tickets").count()).toBe(0);
    });

    test("a belongsTo join finds no ticket", async () => {
      expect(await db().model(Ticket).joins("event").count()).toBe(0);
    });

    test("a belongsTo outer join keeps each ticket once, with no event", async () => {
      expect(await db().model(Ticket).leftJoins("event").count()).toBe(4);
    });

    test("a through preload links no ticket to another", async () => {
      const tickets = await db().model(Ticket).includes("siblings").toArray();

      expect(tickets.map((ticket) => ticket.loaded("siblings"))).toEqual([[], [], [], []]);
    });
  });
});
