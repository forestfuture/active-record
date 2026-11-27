import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { belongsTo, hasMany, Model } from "../../../packages/arbor/src/index.ts";
import { connect } from "../../../packages/arbor/src/adapters/postgresql/index.ts";
import { openPgSchema, type PgSchema } from "../../support/pg.ts";

// A site's gauges, whose real ratio is a 4-byte float4 and whose real wide ratio is a double
// precision, and the readings whose text label holds one of them.
class Site extends Model.define({ id: { type: "integer", null: false } }) {
  static table = "sites";

  gauges = hasMany(Gauge);
  readings = hasMany(Reading, { through: "gauges" });
}

class Gauge extends Model.define({
  id: { type: "integer", null: false },
  siteId: "integer",
  ratio: "real",
  wideRatio: "real",
  readingsCount: "integer",
}) {
  static table = "gauges";

  readings = hasMany(Reading, { foreignKey: "label", primaryKey: "ratio" });
  wideReadings = hasMany(Reading, { foreignKey: "label", primaryKey: "wideRatio" });
}

class Reading extends Model.define({ id: { type: "integer", null: false }, label: "string" }) {
  static table = "readings";
}

// A Model whose table is named like one of Postgres's own types.
class Point extends Model.define({ id: { type: "integer", null: false }, ratio: "real" }) {
  static table = "point";

  readings = hasMany(Reading, { foreignKey: "label", primaryKey: "ratio" });
}

class CountedReading extends Model.define({
  id: { type: "integer", null: false },
  label: "string",
}) {
  static table = "readings";

  gauge = belongsTo(Gauge, {
    foreignKey: "label",
    primaryKey: "ratio",
    counterCache: "readingsCount",
  });
}

// Text linked to a real over a float4 column is read as a float4, as a condition reads it, so a
// fraction links to the float4 it rounds to (#623).
describe("text linked to a float4 real", () => {
  let schema: PgSchema;
  const db = () => connect(schema.url);

  beforeAll(async () => {
    schema = await openPgSchema([]);
    await schema.pool.query({
      text: `CREATE TABLE sites (id BIGINT PRIMARY KEY);
        CREATE TABLE gauges (id BIGINT PRIMARY KEY, site_id BIGINT, ratio REAL,
          wide_ratio DOUBLE PRECISION, readings_count BIGINT NOT NULL DEFAULT 0);
        CREATE INDEX gauges_ratio ON gauges (ratio);
        CREATE TABLE readings (id BIGINT PRIMARY KEY, label TEXT);
        CREATE TABLE point (id BIGINT PRIMARY KEY, ratio REAL);
        INSERT INTO point (id, ratio) VALUES (1, 0.1);`,
    });
  });
  afterAll(() => schema.dispose());

  beforeEach(async () => {
    await schema.pool.query({
      text: `TRUNCATE sites, gauges, readings;
        INSERT INTO sites (id) VALUES (1);
        INSERT INTO gauges (id, site_id, ratio, wide_ratio, readings_count) VALUES (1, 1, 0.1, 0.1, 1);
        INSERT INTO readings (id, label) VALUES (1, '0.1');`,
    });
  });

  /** The plan Postgres picks for `sql` when a sequential scan or a hash or merge join is its last resort. */
  async function planOf({ sql, params }: { sql: string; params: readonly unknown[] }) {
    const client = await schema.pool.connect();
    try {
      await client.query({
        text: "SET enable_seqscan = off; SET enable_hashjoin = off; SET enable_mergejoin = off",
      });
      const { rows } = await client.query({ text: `EXPLAIN ${sql}`, values: [...params] });
      return rows.map((row) => row["QUERY PLAN"] as string).join("\n");
    } finally {
      client.release();
    }
  }

  test("a join finds the gauge by its ratio's text", async () => {
    const gauges = await db().model(Gauge).joins("readings").pluck("id");

    expect(gauges).toEqual([1]);
  });

  test("a through association finds the reading by its gauge's ratio (guard)", async () => {
    const site = await db().model(Site).find(1);

    expect(await site.readings().pluck("id")).toEqual([1]);
  });

  test("a counter cache counts the reading out of its gauge when it's destroyed (guard)", async () => {
    const reading = await db().model(CountedReading).find(1);

    await reading.destroy();

    expect((await db().model(Gauge).find(1)).readingsCount).toBe(0);
  });

  test("a join on a double precision real still finds the gauge by its text (guard)", async () => {
    const gauges = await db().model(Gauge).joins("wideReadings").pluck("id");

    expect(gauges).toEqual([1]);
  });

  test("a join searches the float4 column's index (guard)", async () => {
    const plan = await planOf(db().model(Gauge).joins("readings").toSql());

    expect(plan).toMatch(/Index (Only )?Scan using gauges_ratio on gauges/);
  });

  test("a join finds a row of a table named like a Postgres type", async () => {
    const points = await db().model(Point).joins("readings").pluck("id");

    expect(points).toEqual([1]);
  });

  test.each([
    ["-0.1", -0.1],
    ["-0", 0],
  ])("a join finds a gauge of %s by its text (guard)", async (label, ratio) => {
    await schema.pool.query({ text: "UPDATE gauges SET ratio = $1", values: [ratio] });
    await schema.pool.query({ text: "UPDATE readings SET label = $1", values: [label] });

    expect(await db().model(Gauge).joins("readings").pluck("id")).toEqual([1]);
  });

  test.each(["1e39", "1e-50"])(
    "text past a float4's range, %s, links nothing rather than failing (guard)",
    async (label) => {
      await schema.pool.query({ text: "UPDATE readings SET label = $1", values: [label] });

      expect(await db().model(Gauge).joins("readings").pluck("id")).toEqual([]);
    },
  );
});
