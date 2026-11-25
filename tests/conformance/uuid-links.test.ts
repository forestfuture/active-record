import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { belongsTo, hasMany, Model } from "../../packages/arbor/src/index.ts";
import { openHarness, type Harness } from "../support/harness.ts";

const phoneId = "0b6f8a1e-3c2d-4e5f-9a7b-1c2d3e4f5a6b";

// A UUID key (a UUID column on Postgres) and a text foreign key pointing at it.
class Device extends Model.define({ id: { type: "uuid", null: false }, name: "string" }) {
  static table = "devices";

  readings = hasMany(Reading);
  gauges = hasMany(Gauge, { foreignKey: "level" });
}

class Reading extends Model.define({
  id: { type: "integer", null: false },
  deviceId: "string",
  level: "integer",
}) {
  static table = "readings";

  device = belongsTo(Device);
}

// An integer foreign key (level) pointing at a UUID key, which no integer is.
class Gauge extends Model.define({ id: { type: "integer", null: false }, level: "integer" }) {
  static table = "readings";

  device = belongsTo(Device, { foreignKey: "level" });
}

// Links between a UUID and a text key compare them as a condition on the linked attribute would
// (#563): Postgres compares no uuid with text.
describe("links between a uuid and a text key", () => {
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

  test("a belongsTo preload finds the uuid key a text foreign key holds", async () => {
    await db().model(Reading).insert({ id: 1, deviceId: phoneId });

    const [reading] = await db().model(Reading).includes("device").toArray();

    expect(reading!.loaded("device")?.name).toBe("phone");
  });

  test("a hasMany preload finds the text foreign keys that hold its uuid key", async () => {
    await db()
      .model(Reading)
      .insertAll([
        { id: 1, deviceId: phoneId },
        { id: 2, deviceId: "lamp" },
      ]);

    const [device] = await db().model(Device).includes("readings").toArray();

    expect(device!.loaded("readings").map(({ id }) => id)).toEqual([1]);
  });

  test("joins link a uuid key and a text foreign key either way", async () => {
    await db()
      .model(Reading)
      .insertAll([
        { id: 1, deviceId: phoneId },
        { id: 2, deviceId: "lamp" },
      ]);

    expect(await db().model(Device).joins("readings").pluck("name")).toEqual(["phone"]);
    expect(await db().model(Reading).joins("device").pluck("id")).toEqual([1]);
  });

  test("a text foreign key that isn't a UUID finds nothing, without an error", async () => {
    await db().model(Reading).insert({ id: 1, deviceId: "lamp" });

    const [reading] = await db().model(Reading).includes("device").toArray();

    expect(reading!.loaded("device")).toBeNull();
  });

  test("a uuid key and an integer foreign key find nothing either way, without an error", async () => {
    await db().model(Gauge).insert({ id: 1, level: 7 });

    const [device] = await db().model(Device).includes("gauges").toArray();
    const [gauge] = await db().model(Gauge).includes("device").toArray();

    expect(device!.loaded("gauges")).toEqual([]);
    expect(gauge!.loaded("device")).toBeNull();
    expect(await db().model(Device).joins("gauges").count()).toBe(0);
    expect(await db().model(Gauge).joins("device").count()).toBe(0);
  });
});
