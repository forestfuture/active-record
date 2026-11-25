import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { belongsTo, hasMany, Model } from "../../../packages/arbor/src/index.ts";
import { connect } from "../../../packages/arbor/src/adapters/postgresql/index.ts";
import { openPgSchema, type PgSchema } from "../../support/pg.ts";

const phoneId = "0b6f8a1e-3c2d-4e5f-9a7b-1c2d3e4f5a6b";

class Device extends Model.define({ id: { type: "uuid", null: false }, name: "string" }) {
  static table = "devices";

  readings = hasMany(Reading);
}

class Reading extends Model.define({ id: { type: "integer", null: false }, deviceId: "string" }) {
  static table = "readings";

  device = belongsTo(Device);
}

// Text selected for a uuid is the UUID it holds, in any form Postgres reads, as a condition on
// the uuid finds it (#563). D1 compares the text exactly: an allowed difference. A UUID selected
// for the text is its own form, as a condition on the text compares it.
describe("a text foreign key linked to a UUID key", () => {
  let schema: PgSchema;
  const db = () => connect(schema.url);
  const readings = () => db().model(Reading);

  beforeAll(async () => {
    schema = await openPgSchema([new URL("../../fixtures/postgres/uuids.sql", import.meta.url)]);
    await schema.pool.query({
      text: "INSERT INTO devices (id, name) VALUES ($1, 'phone')",
      values: [phoneId],
    });
  });
  afterAll(() => schema.dispose());

  test.each([
    ["capitals", phoneId.toUpperCase()],
    ["braces", `{${phoneId}}`],
    ["no hyphens", phoneId.replaceAll("-", "")],
  ])("finds the device by a UUID in %s", async (_, deviceId) => {
    await schema.pool.query({ text: "DELETE FROM readings" });
    await readings().insert({ id: 1, deviceId });

    const [reading] = await readings().includes("device").toArray();

    expect(reading!.loaded("device")?.name).toBe("phone");
    expect(await db().model(Device).joins("readings").count()).toBe(1);
  });
});
