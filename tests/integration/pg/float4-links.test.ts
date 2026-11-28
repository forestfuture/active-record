import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { belongsTo, hasMany, Model } from "../../../packages/arbor/src/index.ts";
import { connect } from "../../../packages/arbor/src/adapters/postgresql/index.ts";
import { openPgSchema, type PgSchema } from "../../support/pg.ts";

/** The plan Postgres picks for `sql` when a sequential scan or a hash or merge join is its last resort. */
async function planOf(
  schema: PgSchema,
  { sql, params }: { sql: string; params: readonly unknown[] },
) {
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

// A plant's meters, and their samples through them.
class Plant extends Model.define({ id: { type: "integer", null: false } }) {
  static table = "plants";

  meters = hasMany(Meter);
  samplesWideToNarrow = hasMany(Sample, { through: "meters", source: "wideToNarrow" });
  samplesNarrowToWide = hasMany(Sample, { through: "meters", source: "narrowToWide" });
  samplesExactToNarrow = hasMany(Sample, { through: "meters", source: "exactToNarrow" });
  samplesNarrowToExact = hasMany(Sample, { through: "meters", source: "narrowToExact" });
  samplesExactToWide = hasMany(Sample, { through: "meters", source: "exactToWide" });
}

// A meter's ratio, as a 4-byte float4 real, a double precision real and a decimal, and the
// samples whose own ratio of one width or type is linked to one of the meter's of another.
class Meter extends Model.define({
  id: { type: "integer", null: false },
  narrow: "real",
  wide: "real",
  exact: "decimal",
  plantId: "integer",
  wideToNarrowCount: "integer",
  narrowToWideCount: "integer",
  exactToNarrowCount: "integer",
  narrowToExactCount: "integer",
  exactToWideCount: "integer",
}) {
  static table = "meters";

  // Each links a sample's ratio of one width or type to the meter's of another.
  wideToNarrow = hasMany(Sample, { foreignKey: "wide", primaryKey: "narrow" });
  narrowToWide = hasMany(Sample, { foreignKey: "narrow", primaryKey: "wide" });
  exactToNarrow = hasMany(Sample, { foreignKey: "exact", primaryKey: "narrow" });
  narrowToExact = hasMany(Sample, { foreignKey: "narrow", primaryKey: "exact" });
  wideToExact = hasMany(Sample, { foreignKey: "wide", primaryKey: "exact" });
  exactToWide = hasMany(Sample, { foreignKey: "exact", primaryKey: "wide" });
}

class Sample extends Model.define({
  id: { type: "integer", null: false },
  narrow: "real",
  wide: "real",
  exact: "decimal",
}) {
  static table = "samples";
}

// A float4 real in a table named like a Postgres type, whose column's type is read from it.
class Point extends Model.define({ id: { type: "integer", null: false }, ratio: "real" }) {
  static table = "point";

  samples = hasMany(Sample, { foreignKey: "wide", primaryKey: "ratio" });
}

// A sample counted on its meter by each link of its ratios to the meter's of another width.
class CountedSample extends Model.define({
  id: { type: "integer", null: false },
  narrow: "real",
  wide: "real",
  exact: "decimal",
}) {
  static table = "samples";

  wideToNarrow = belongsTo(Meter, {
    foreignKey: "wide",
    primaryKey: "narrow",
    counterCache: "wideToNarrowCount",
  });
  narrowToWide = belongsTo(Meter, {
    foreignKey: "narrow",
    primaryKey: "wide",
    counterCache: "narrowToWideCount",
  });
  exactToNarrow = belongsTo(Meter, {
    foreignKey: "exact",
    primaryKey: "narrow",
    counterCache: "exactToNarrowCount",
  });
  narrowToExact = belongsTo(Meter, {
    foreignKey: "narrow",
    primaryKey: "exact",
    counterCache: "narrowToExactCount",
  });
  exactToWide = belongsTo(Meter, {
    foreignKey: "exact",
    primaryKey: "wide",
    counterCache: "exactToWideCount",
  });
}

// A number linked to a float4 real, or a float4 linked to a number of another width or type, is
// compared at a float4's precision, as a condition is, rather than by widening the float4, and a
// real of either width linked to a decimal is read through its text (#625).
describe("a real linked to a number of another width or type", () => {
  let schema: PgSchema;
  const db = () => connect(schema.url);

  beforeAll(async () => {
    schema = await openPgSchema([]);
    await schema.pool.query({
      text: `CREATE TABLE plants (id BIGINT PRIMARY KEY);
        CREATE TABLE meters (id BIGINT PRIMARY KEY, narrow REAL, wide DOUBLE PRECISION,
          exact NUMERIC, plant_id BIGINT, wide_to_narrow_count BIGINT NOT NULL DEFAULT 0,
          narrow_to_wide_count BIGINT NOT NULL DEFAULT 0,
          exact_to_narrow_count BIGINT NOT NULL DEFAULT 0,
          narrow_to_exact_count BIGINT NOT NULL DEFAULT 0,
          exact_to_wide_count BIGINT NOT NULL DEFAULT 0);
        CREATE INDEX meters_narrow ON meters (narrow);
        CREATE INDEX meters_wide ON meters (wide);
        CREATE INDEX meters_exact ON meters (exact);
        CREATE TABLE samples (id BIGINT PRIMARY KEY, narrow REAL, wide DOUBLE PRECISION,
          exact NUMERIC);
        CREATE TABLE point (id BIGINT PRIMARY KEY, ratio REAL);
        INSERT INTO point (id, ratio) VALUES (1, 0.1);`,
    });
  });
  afterAll(() => schema.dispose());

  beforeEach(async () => {
    await schema.pool.query({
      text: `TRUNCATE plants, meters, samples;
        INSERT INTO plants (id) VALUES (1);
        INSERT INTO meters (id, narrow, wide, exact, plant_id, wide_to_narrow_count,
          narrow_to_wide_count, exact_to_narrow_count, narrow_to_exact_count,
          exact_to_wide_count)
          VALUES (1, 0.1, 0.1, 0.1, 1, 1, 1, 1, 1, 1);
        INSERT INTO samples (id, narrow, wide, exact) VALUES (1, 0.1, 0.1, 0.1);`,
    });
  });

  test("a join finds a row of a table named like a Postgres type", async () => {
    expect(await db().model(Point).joins("samples").pluck("id")).toEqual([1]);
  });

  test("a join finds the meter by a double precision 0.1", async () => {
    const meters = await db().model(Meter).joins("wideToNarrow").pluck("id");

    expect(meters).toEqual([1]);
  });

  test.each(["1e39", "-1e39", "1e-50"])(
    "a double precision past a float4's range, %s, links nothing rather than failing",
    async (wide) => {
      await schema.pool.query({ text: "UPDATE samples SET wide = $1", values: [wide] });

      expect(await db().model(Meter).joins("wideToNarrow").pluck("id")).toEqual([]);
    },
  );

  test.each(["3.4028234663852886e38", "1.401298464324817e-45", "0", "Infinity", "-Infinity"])(
    "a join finds the meter by a double precision %s a float4 holds (guard)",
    async (wide) => {
      await schema.pool.query({ text: "UPDATE meters SET narrow = $1", values: [wide] });
      await schema.pool.query({ text: "UPDATE samples SET wide = $1", values: [wide] });

      expect(await db().model(Meter).joins("wideToNarrow").pluck("id")).toEqual([1]);
    },
  );

  test("a join finds the meter by a float4 0.1", async () => {
    const meters = await db().model(Meter).joins("narrowToWide").pluck("id");

    expect(meters).toEqual([1]);
  });

  test.each(["3.4028235e38", "1e-45", "-0.1", "Infinity"])(
    "a join finds the meter by a float4 %s (guard)",
    async (ratio) => {
      await schema.pool.query({ text: "UPDATE samples SET narrow = $1", values: [ratio] });
      await schema.pool.query({ text: "UPDATE meters SET wide = $1", values: [ratio] });

      expect(await db().model(Meter).joins("narrowToWide").pluck("id")).toEqual([1]);
    },
  );

  test.each(["exactToNarrow", "narrowToExact"] as const)(
    "a join through %s finds the meter by 0.1 (guard)",
    async (association) => {
      expect(await db().model(Meter).joins(association).pluck("id")).toEqual([1]);
    },
  );

  test.each(["NaN", "Infinity", "-Infinity"])(
    "a join finds the meter by a decimal %s",
    async (exact) => {
      await schema.pool.query({ text: "UPDATE meters SET narrow = $1", values: [exact] });
      await schema.pool.query({ text: "UPDATE samples SET exact = $1", values: [exact] });

      expect(await db().model(Meter).joins("exactToNarrow").pluck("id")).toEqual([1]);
    },
  );

  test("a join finds the meter by a decimal of a float4's greatest value (guard)", async () => {
    const greatest = "3.4028234663852886e38";
    await schema.pool.query({ text: "UPDATE meters SET narrow = $1", values: [greatest] });
    await schema.pool.query({ text: "UPDATE samples SET exact = $1", values: [greatest] });

    expect(await db().model(Meter).joins("exactToNarrow").pluck("id")).toEqual([1]);
  });

  test("a join finds the meter by a double precision NaN (guard)", async () => {
    await schema.pool.query({ text: "UPDATE meters SET narrow = 'NaN'" });
    await schema.pool.query({ text: "UPDATE samples SET wide = 'NaN'" });

    expect(await db().model(Meter).joins("wideToNarrow").pluck("id")).toEqual([1]);
  });

  test.each(["1e39", "1e-50", "1e400", "1e131030"])(
    "a decimal past a float4's range, %s, links nothing rather than failing",
    async (exact) => {
      await schema.pool.query({ text: "UPDATE samples SET exact = $1", values: [exact] });

      expect(await db().model(Meter).joins("exactToNarrow").pluck("id")).toEqual([]);
    },
  );

  test.each([
    "samplesWideToNarrow",
    "samplesNarrowToWide",
    "samplesExactToNarrow",
    "samplesNarrowToExact",
    "samplesExactToWide",
  ] as const)(
    "a through association, %s, finds the sample by its meter's ratio (guard)",
    async (association) => {
      const plant = await db().model(Plant).find(1);

      expect(await plant[association]().pluck("id")).toEqual([1]);
    },
  );

  test("a counter cache counts the sample out of its meter by each link (guard)", async () => {
    const sample = await db().model(CountedSample).find(1);

    await sample.destroy();

    const meter = await db().model(Meter).find(1);
    expect([
      meter.wideToNarrowCount,
      meter.narrowToWideCount,
      meter.exactToNarrowCount,
      meter.narrowToExactCount,
      meter.exactToWideCount,
    ]).toEqual([0, 0, 0, 0, 0]);
  });

  test.each([
    ["wideToNarrow", "meters_narrow"],
    ["narrowToWide", "meters_wide"],
    ["narrowToExact", "meters_exact"],
    ["wideToExact", "meters_exact"],
    ["exactToWide", "meters_wide"],
  ] as const)("a join through %s searches %s", async (association, index) => {
    const plan = await planOf(schema, db().model(Meter).joins(association).toSql());

    expect(plan).toMatch(new RegExp(`Index (Only )?Scan using ${index} on meters`));
  });

  // A decimal linked to a double precision is cast to one only when a double holds it (#628).
  test.each(["1e400", "-1e400", "1e-400", "1e131030"])(
    "a decimal past a double precision's range, %s, links nothing rather than failing",
    async (exact) => {
      await schema.pool.query({ text: "UPDATE samples SET exact = $1", values: [exact] });

      expect(await db().model(Meter).joins("exactToWide").pluck("id")).toEqual([]);
    },
  );

  test.each([
    "1.7976931348623157e308",
    "-1.7976931348623157e308",
    "5e-324",
    "0",
    "NaN",
    "Infinity",
    "-Infinity",
  ])("a join finds the meter by a decimal %s a double precision holds (guard)", async (exact) => {
    await schema.pool.query({ text: "UPDATE meters SET wide = $1", values: [exact] });
    await schema.pool.query({ text: "UPDATE samples SET exact = $1", values: [exact] });

    expect(await db().model(Meter).joins("exactToWide").pluck("id")).toEqual([1]);
  });

  test("a through association past a decimal a double can't hold links nothing", async () => {
    await schema.pool.query({ text: "UPDATE samples SET exact = 1e400" });
    const plant = await db().model(Plant).find(1);

    expect(await plant.samplesExactToWide().pluck("id")).toEqual([]);
  });

  test("a counter cache counts nothing out by a stored decimal a double can't hold", async () => {
    const sample = await db().model(CountedSample).find(1);
    await schema.pool.query({ text: "UPDATE samples SET exact = 1e400" });

    await sample.destroy();

    expect((await db().model(Meter).find(1)).exactToWideCount).toBe(1);
  });

  test.each(["narrowToExact", "wideToExact"] as const)(
    "a join through %s past a decimal a double can't hold links nothing rather than failing",
    async (association) => {
      await schema.pool.query({ text: "UPDATE meters SET exact = 1e400" });

      expect(await db().model(Meter).joins(association).pluck("id")).toEqual([]);
    },
  );

  test("a join finds the meter by a double precision 0.1 linked to a decimal (guard)", async () => {
    expect(await db().model(Meter).joins("wideToExact").pluck("id")).toEqual([1]);
  });

  test("a double precision links to a decimal by its shortest text, not a rounded decimal", async () => {
    await schema.pool.query({ text: "UPDATE meters SET exact = 0.30000000000000001" });
    await schema.pool.query({ text: "UPDATE samples SET wide = 0.3" });

    expect(await db().model(Meter).joins("wideToExact").pluck("id")).toEqual([]);
  });
});
