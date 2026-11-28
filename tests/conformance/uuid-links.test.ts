import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { belongsTo, hasMany, Model, withDatabase } from "../../packages/arbor/src/index.ts";
import { openHarness, type Harness } from "../support/harness.ts";

const phoneId = "0b6f8a1e-3c2d-4e5f-9a7b-1c2d3e4f5a6b";
const tabletId = "5d4c3b2a-1f0e-4d9c-8b7a-6f5e4d3c2b1a";

// A UUID in another form than its one, as a uuid is held: text compares exactly on D1.
const otherForms = [
  ["capitals", phoneId.toUpperCase()],
  ["braces", `{${phoneId}}`],
  ["no hyphens", phoneId.replaceAll("-", "")],
];

// A UUID key (a UUID column on Postgres) and a text foreign key pointing at it.
class Device extends Model.define({
  id: { type: "uuid", null: false },
  name: "string",
  readingsCount: { type: "integer", null: false },
  updatedAt: "datetime",
}) {
  static table = "devices";

  readings = hasMany(Reading);
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

// A reading its device counts (#588).
class CountedReading extends Model.define({
  id: { type: "integer", null: false },
  deviceId: "string",
}) {
  static table = "readings";

  device = belongsTo(Device, { counterCache: "readingsCount", optional: true });
}

// A reading that touches its device (#588).
class TouchingReading extends Model.define({
  id: { type: "integer", null: false },
  deviceId: "string",
}) {
  static table = "readings";

  device = belongsTo(Device, { touch: true, optional: true });
}

// A text key pointed at by a uuid foreign key (a UUID column on Postgres), counted (#588).
class Phone extends Model.define({
  id: { type: "string", null: false },
  callsCount: { type: "integer", null: false },
}) {
  static table = "phones";

  calls = hasMany(Call);
}

class Call extends Model.define({ id: { type: "integer", null: false }, phoneId: "uuid" }) {
  static table = "calls";

  phone = belongsTo(Phone, { counterCache: true, optional: true });
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

    test("a polymorphic hasMany join finds the text ids that hold its uuid key", async () => {
      await db()
        .model(Note)
        .insertAll([
          { id: 1, subjectType: "Device", subjectId: phoneId },
          { id: 2, subjectType: "Device", subjectId: phoneId.toUpperCase() },
        ]);

      expect(await db().model(Device).joins("notes").pluck("name")).toEqual(["phone"]);
    });

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
      "a required belongsTo is invalid by a text foreign key holding a uuid key in %s",
      async (_, deviceId) => {
        const reading = db().model(Reading).build({ id: 1, deviceId });

        expect(await reading.isValid()).toBe(false);
        expect(reading.errors.get("device")).toEqual(["must exist"]);
      },
    );

    test.each(otherForms)(
      "a counter cache counts nothing in for a text foreign key holding a uuid key in %s",
      async (_, deviceId) => {
        await db().model(CountedReading).create({ id: 1, deviceId });

        expect((await db().model(Device).find(phoneId)).readingsCount).toBe(0);
      },
    );

    test("a counter cache counts a text foreign key holding a uuid key out when it changes", async () => {
      const reading = await db().model(CountedReading).create({ id: 1, deviceId: phoneId });

      await reading.update({ deviceId: null });

      expect((await db().model(Device).find(phoneId)).readingsCount).toBe(0);
    });

    test("a counter cache moves a text foreign key's count to the uuid key it changes to", async () => {
      await harness.exec("INSERT INTO devices (id, name) VALUES (?, ?)", [tabletId, "tablet"]);
      const reading = await db().model(CountedReading).create({ id: 1, deviceId: phoneId });

      await reading.update({ deviceId: tabletId });

      const devices = [
        await db().model(Device).find(phoneId),
        await db().model(Device).find(tabletId),
      ];
      expect(devices.map((device) => device.readingsCount)).toEqual([0, 1]);
    });

    test("a counter cache counts a text foreign key holding a uuid key out when it's destroyed", async () => {
      const reading = await db().model(CountedReading).create({ id: 1, deviceId: phoneId });

      await reading.destroy();

      expect((await db().model(Device).find(phoneId)).readingsCount).toBe(0);
    });

    test.each(otherForms)(
      "a counter cache counts out nothing for a text foreign key holding a uuid key in %s",
      async (_, deviceId) => {
        const reading = await db().model(CountedReading).create({ id: 1, deviceId });
        await harness.exec("UPDATE devices SET readings_count = 1 WHERE id = ?", [phoneId]);

        await reading.destroy();

        expect((await db().model(Device).find(phoneId)).readingsCount).toBe(1);
      },
    );

    test("a counter cache counts nothing in for a text foreign key that isn't a UUID, without an error", async () => {
      await db().model(CountedReading).create({ id: 1, deviceId: "lamp" });

      expect((await db().model(Device).find(phoneId)).readingsCount).toBe(0);
    });

    test.each(otherForms)(
      "a touch reaches no uuid key by a text foreign key holding it in %s, on create or when it changes",
      async (_, deviceId) => {
        const reading = await db().model(TouchingReading).create({ id: 1, deviceId });
        await reading.update({ deviceId: null });

        expect((await db().model(Device).find(phoneId)).updatedAt).toBeNull();
      },
    );

    test.each(otherForms)(
      "a condition with a uuid key in %s still finds its record",
      async (_, id) => {
        const found = [
          (await db().model(Device).find(id)).name,
          (await db().model(Device).findBy({ id }))?.name,
          await db().model(Device).where({ id }).pluck("name"),
        ];

        expect(found).toEqual(["phone", "phone", ["phone"]]);
      },
    );

    test.each(otherForms)(
      "a through association reads nothing by a text foreign key holding a uuid key in %s",
      async (_, deviceId) => {
        await db()
          .model(Reading)
          .insertAll([
            { id: 1, deviceId: phoneId },
            { id: 2, deviceId },
          ]);
        const reading = await db().model(Reading).find(2);

        expect(await reading.siblings().pluck("id")).toEqual([]);
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

  // A text key in another form than a uuid's one finds none of its records (#588), read or
  // preloaded alike.
  describe("from a text key to a uuid foreign key", () => {
    beforeEach(async () => {
      await harness.reset("phones", "calls");
      await db().model(Call).insert({ id: 1, phoneId });
    });

    test.each(otherForms)("in %s, a hasMany reads none of its records", async (_, id) => {
      const phone = await db().model(Phone).create({ id });

      expect(await phone.calls().pluck("id")).toEqual([]);
    });

    test.each(otherForms)("in %s, a hasMany preloads none of its records", async (_, id) => {
      await db().model(Phone).create({ id });

      const [phone] = await db().model(Phone).includes("calls").toArray();

      expect(phone!.loaded("calls")).toEqual([]);
    });

    test.each(otherForms)(
      "in %s, a record built through a hasMany is refused: its key links to no uuid",
      async (_, id) => {
        const phone = await db().model(Phone).create({ id });

        expect(() => phone.calls().build({ id: 2 })).toThrow(/phoneId/);
      },
    );

    test.each(otherForms)("in %s, resetCounters counts none of its records", async (_, id) => {
      await db().model(Phone).create({ id });

      await withDatabase(db(), () => Phone.resetCounters(id, "calls"));

      expect((await db().model(Phone).find(id)).callsCount).toBe(0);
    });

    test("a uuid foreign key counts out of its text key when it changes", async () => {
      await db().model(Phone).create({ id: phoneId, callsCount: 0 });
      const call = await db().model(Call).create({ id: 2, phoneId });

      await call.update({ phoneId: null });

      expect((await db().model(Phone).find(phoneId)).callsCount).toBe(0);
    });

    test("a uuid foreign key moves its count to the text key it changes to", async () => {
      await db()
        .model(Phone)
        .insertAll([
          { id: phoneId, callsCount: 0 },
          { id: tabletId, callsCount: 0 },
        ]);
      const call = await db().model(Call).create({ id: 2, phoneId });

      await call.update({ phoneId: tabletId });

      const phones = [
        await db().model(Phone).find(phoneId),
        await db().model(Phone).find(tabletId),
      ];
      expect(phones.map((phone) => phone.callsCount)).toEqual([0, 1]);
    });

    test("a uuid foreign key counts out of its text key when it's destroyed", async () => {
      await db().model(Phone).create({ id: phoneId, callsCount: 0 });
      const call = await db().model(Call).create({ id: 2, phoneId });

      await call.destroy();

      expect((await db().model(Phone).find(phoneId)).callsCount).toBe(0);
    });

    test("in its one form, a hasMany reads, preloads and counts its records", async () => {
      const phone = await db().model(Phone).create({ id: phoneId });
      await withDatabase(db(), () => Phone.resetCounters(phoneId, "calls"));
      const [preloaded] = await db().model(Phone).includes("calls").toArray();

      expect([
        await phone.calls().pluck("id"),
        preloaded!.loaded("calls").map(({ id }) => id),
        preloaded!.callsCount,
      ]).toEqual([[1], [1], 1]);
    });
  });
});
