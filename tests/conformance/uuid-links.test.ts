import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { belongsTo, hasMany, Model } from "../../packages/arbor/src/index.ts";
import { openHarness, type Harness } from "../support/harness.ts";

const phoneId = "0b6f8a1e-3c2d-4e5f-9a7b-1c2d3e4f5a6b";

// A UUID key (a UUID column on Postgres) and a text foreign key pointing at it.
class Device extends Model.define({ id: { type: "uuid", null: false }, name: "string" }) {
  static table = "devices";

  readings = hasMany(Reading);
  gauges = hasMany(Gauge, { foreignKey: "level" });
  notes = hasMany(Note, { as: "subject" });
}

class Reading extends Model.define({
  id: { type: "integer", null: false },
  deviceId: "string",
  level: "integer",
}) {
  static table = "readings";

  device = belongsTo(Device);
  siblings = hasMany(Reading, { through: "device", source: "readings" });
}

// An integer foreign key (level) pointing at a UUID key, which no integer is.
class Gauge extends Model.define({ id: { type: "integer", null: false }, level: "integer" }) {
  static table = "readings";

  device = belongsTo(Device, { foreignKey: "level" });
}

// A polymorphic text id (subject_id) pointing at a UUID key.
class Note extends Model.define({
  id: { type: "integer", null: false },
  subjectType: "string",
  subjectId: "string",
}) {
  static table = "readings";

  subject = belongsTo([Device], { optional: true });
}

// A link between a UUID and another key compares them as a condition on the linked attribute
// would (#563): Postgres compares no uuid with text or a number.
describe("uuid links", () => {
  let harness: Harness;
  const db = () => harness.connect();

  beforeAll(async () => {
    harness = await openHarness({ schema: "uuids" });
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.reset("devices", "readings");
    await harness.exec("INSERT INTO devices (id, name) VALUES (?, ?)", [phoneId, "phone"]);
  });

  describe("to a text key", () => {
    // The phone's reading, and one whose text isn't a UUID.
    const insertReadings = () =>
      db()
        .model(Reading)
        .insertAll([
          { id: 1, deviceId: phoneId },
          { id: 2, deviceId: "lamp" },
        ]);

    test("a belongsTo preload finds the uuid key a text foreign key holds", async () => {
      await db().model(Reading).insert({ id: 1, deviceId: phoneId });

      const [reading] = await db().model(Reading).includes("device").toArray();

      expect(reading!.loaded("device")?.name).toBe("phone");
    });

    test("a hasMany preload finds the text foreign keys that hold its uuid key", async () => {
      await insertReadings();

      const [device] = await db().model(Device).includes("readings").toArray();

      expect(device!.loaded("readings").map(({ id }) => id)).toEqual([1]);
    });

    test("a join from the uuid key finds the text foreign keys that hold it", async () => {
      await insertReadings();

      expect(await db().model(Device).joins("readings").pluck("name")).toEqual(["phone"]);
    });

    test("a join from the text foreign key finds the uuid key it holds", async () => {
      await insertReadings();

      expect(await db().model(Reading).joins("device").pluck("id")).toEqual([1]);
    });

    test("a through association reads the records its text foreign keys link", async () => {
      await insertReadings();
      await db().model(Reading).insert({ id: 3, deviceId: phoneId });
      const reading = await db().model(Reading).find(1);

      expect(await reading.siblings().order({ id: "asc" }).pluck("id")).toEqual([1, 3]);
    });

    test("a polymorphic belongsTo preload finds the uuid key a text id holds", async () => {
      await db().model(Note).insert({ id: 1, subjectType: "Device", subjectId: phoneId });

      const [note] = await db().model(Note).includes("subject").toArray();

      expect((note!.loaded("subject") as Device | null)?.name).toBe("phone");
    });

    test("a polymorphic hasMany preload finds the text ids that hold its uuid key", async () => {
      await db().model(Note).insert({ id: 1, subjectType: "Device", subjectId: phoneId });

      const [device] = await db().model(Device).includes("notes").toArray();

      expect(device!.loaded("notes").map(({ id }) => id)).toEqual([1]);
    });

    // A UUID in another form than its one, as a uuid is held: text compares exactly on D1.
    const otherForms = [
      ["capitals", phoneId.toUpperCase()],
      ["braces", `{${phoneId}}`],
      ["no hyphens", phoneId.replaceAll("-", "")],
    ];

    test.each(otherForms)(
      "a belongsTo preload finds no uuid key for a text foreign key holding it in %s",
      async (_, deviceId) => {
        await db().model(Reading).insert({ id: 1, deviceId });

        const [reading] = await db().model(Reading).includes("device").toArray();

        expect(reading!.loaded("device")).toBeNull();
      },
    );

    test.each(otherForms)(
      "a belongsTo preload loads no uuid key for a text foreign key holding it in %s beside one in its one form",
      async (_, deviceId) => {
        await db()
          .model(Reading)
          .insertAll([
            { id: 1, deviceId: phoneId },
            { id: 2, deviceId },
          ]);

        const readings = await db()
          .model(Reading)
          .includes("device")
          .order({ id: "asc" })
          .toArray();

        expect(readings.map((reading) => reading.loaded("device")?.name ?? null)).toEqual([
          "phone",
          null,
        ]);
      },
    );

    test.each(otherForms)(
      "a through preload reaches nothing by a text foreign key holding a uuid key in %s beside one in its one form",
      async (_, deviceId) => {
        await db()
          .model(Reading)
          .insertAll([
            { id: 1, deviceId: phoneId },
            { id: 2, deviceId },
          ]);

        const readings = await db()
          .model(Reading)
          .includes("siblings")
          .order({ id: "asc" })
          .toArray();

        expect(readings.map((reading) => reading.loaded("siblings").map(({ id }) => id))).toEqual([
          [1],
          [],
        ]);
      },
    );

    test.each(otherForms)(
      "a polymorphic belongsTo preload loads no uuid key for a text id holding it in %s beside one in its one form",
      async (_, subjectId) => {
        await db()
          .model(Note)
          .insertAll([
            { id: 1, subjectType: "Device", subjectId: phoneId },
            { id: 2, subjectType: "Device", subjectId },
          ]);

        const notes = await db().model(Note).includes("subject").order({ id: "asc" }).toArray();

        expect(
          notes.map((note) => (note.loaded("subject") as Device | null)?.name ?? null),
        ).toEqual(["phone", null]);
      },
    );

    test.each(otherForms)(
      "a join from the uuid key finds no text foreign key holding it in %s",
      async (_, deviceId) => {
        await db().model(Reading).insert({ id: 1, deviceId });

        expect(await db().model(Device).joins("readings").count()).toBe(0);
      },
    );

    test.each(otherForms)(
      "a hasMany preload finds no text foreign key holding its uuid key in %s",
      async (_, deviceId) => {
        await db().model(Reading).insert({ id: 1, deviceId });

        const [device] = await db().model(Device).includes("readings").toArray();

        expect(device!.loaded("readings")).toEqual([]);
      },
    );

    test.each(otherForms)(
      "a join from a text foreign key holding a uuid key in %s finds nothing",
      async (_, deviceId) => {
        await db().model(Reading).insert({ id: 1, deviceId });

        expect(await db().model(Reading).joins("device").count()).toBe(0);
      },
    );

    // A record's key links as it's stored (#588): its lazy read agrees with its preload.
    test.each(otherForms)(
      "a belongsTo reads no uuid key for a text foreign key holding it in %s",
      async (_, deviceId) => {
        await db().model(Reading).insert({ id: 1, deviceId });
        const reading = await db().model(Reading).find(1);

        expect(await reading.device()).toBeNull();
      },
    );

    test.each(otherForms)(
      "a polymorphic belongsTo reads no uuid key for a text id holding it in %s",
      async (_, subjectId) => {
        await db().model(Note).insert({ id: 1, subjectType: "Device", subjectId });
        const note = await db().model(Note).find(1);

        expect(await note.subject()).toBeNull();
      },
    );

    test("a text foreign key that isn't a UUID finds nothing, without an error", async () => {
      await db().model(Reading).insert({ id: 1, deviceId: "lamp" });

      const [reading] = await db().model(Reading).includes("device").toArray();

      expect(reading!.loaded("device")).toBeNull();
    });
  });

  describe("to an integer key", () => {
    beforeEach(async () => {
      await db().model(Gauge).insert({ id: 1, level: 7 });
    });

    test("a hasMany preload from the uuid key finds nothing, without an error", async () => {
      const [device] = await db().model(Device).includes("gauges").toArray();

      expect(device!.loaded("gauges")).toEqual([]);
    });

    test("a belongsTo preload from the integer key finds nothing, without an error", async () => {
      const [gauge] = await db().model(Gauge).includes("device").toArray();

      expect(gauge!.loaded("device")).toBeNull();
    });

    test("a join from the uuid key finds nothing, without an error", async () => {
      expect(await db().model(Device).joins("gauges").count()).toBe(0);
    });

    test("a join from the integer key finds nothing, without an error", async () => {
      expect(await db().model(Gauge).joins("device").count()).toBe(0);
    });
  });
});
