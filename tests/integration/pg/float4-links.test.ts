import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { hasMany, Model } from "../../../packages/arbor/src/index.ts";
import { connect } from "../../../packages/arbor/src/adapters/postgresql/index.ts";
import { openPgSchema, type PgSchema } from "../../support/pg.ts";

// A gauge whose real ratio is a 4-byte float4, and the readings whose text label holds one.
class Gauge extends Model.define({ id: { type: "integer", null: false }, ratio: "real" }) {
  static table = "gauges";

  readings = hasMany(Reading, { foreignKey: "label", primaryKey: "ratio" });
}

class Reading extends Model.define({ id: { type: "integer", null: false }, label: "string" }) {
  static table = "readings";
}

// Text linked to a real over a float4 column is read as a float4, as a condition reads it, so a
// fraction links to the float4 it rounds to (#623).
describe("text linked to a float4 real", () => {
  let schema: PgSchema;
  const db = () => connect(schema.url);

  beforeAll(async () => {
    schema = await openPgSchema([]);
    await schema.pool.query({
      text: `CREATE TABLE gauges (id BIGINT PRIMARY KEY, ratio REAL);
        CREATE TABLE readings (id BIGINT PRIMARY KEY, label TEXT);`,
    });
  });
  afterAll(() => schema.dispose());

  beforeEach(async () => {
    await schema.pool.query({
      text: `TRUNCATE gauges, readings;
        INSERT INTO gauges (id, ratio) VALUES (1, 0.1);
        INSERT INTO readings (id, label) VALUES (1, '0.1');`,
    });
  });

  test("a join finds the gauge by its ratio's text", async () => {
    const gauges = await db().model(Gauge).joins("readings").pluck("id");

    expect(gauges).toEqual([1]);
  });
});
