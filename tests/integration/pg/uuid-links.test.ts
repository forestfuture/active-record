import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { belongsTo, Model } from "../../../packages/arbor/src/index.ts";
import { connect } from "../../../packages/arbor/src/adapters/postgresql/index.ts";
import { openPgSchema, type PgSchema } from "../../support/pg.ts";

const phoneId = "0b6f8a1e-3c2d-4e5f-9a7b-1c2d3e4f5a6b";

class Device extends Model.define({ id: { type: "uuid", null: false }, name: "string" }) {
  static table = "devices";
}

// A text foreign key in a column whose collation ignores case, where Postgres runs no regular
// expression, so the check that its text is a UUID runs under C's collation (#563).
class FoldedReading extends Model.define({
  id: { type: "integer", null: false },
  deviceId: "string",
}) {
  static table = "folded_readings";

  device = belongsTo(Device);
}

describe("a text foreign key linked to a UUID key", () => {
  let schema: PgSchema;
  const db = () => connect(schema.url);

  beforeAll(async () => {
    schema = await openPgSchema([new URL("../../fixtures/postgres/uuids.sql", import.meta.url)]);
    await schema.pool.query({
      text: "INSERT INTO devices (id, name) VALUES ($1, 'phone')",
      values: [phoneId],
    });
    await schema.pool.query({
      text:
        "CREATE COLLATION folded (provider = icu, locale = 'und-u-ks-level2', deterministic = false);" +
        "CREATE TABLE folded_readings (id INTEGER PRIMARY KEY, device_id TEXT COLLATE folded)",
    });
  });
  afterAll(() => schema.dispose());

  test("a text column whose collation ignores case links to its UUID key", async () => {
    await db().model(FoldedReading).insert({ id: 1, deviceId: phoneId });

    const [reading] = await db().model(FoldedReading).includes("device").toArray();

    expect(reading!.loaded("device")?.name).toBe("phone");
  });
});
