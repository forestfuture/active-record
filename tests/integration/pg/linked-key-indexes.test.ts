import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { hasMany, Model } from "../../../packages/arbor/src/index.ts";
import { connect } from "../../../packages/arbor/src/adapters/postgresql/index.ts";
import { openPgSchema, type PgSchema } from "../../support/pg.ts";

// A target whose integer id, real ratio and decimal amount are each indexed, and the references
// whose text label holds one of them.
class Target extends Model.define({
  id: { type: "integer", null: false },
  ratio: "real",
  amount: { type: "decimal", precision: 10, scale: 2 },
}) {
  static table = "targets";

  byId = hasMany(Reference, { foreignKey: "label" });
  byRatio = hasMany(Reference, { foreignKey: "label", primaryKey: "ratio" });
  byAmount = hasMany(Reference, { foreignKey: "label", primaryKey: "amount" });
}

class Reference extends Model.define({ id: { type: "integer", null: false }, label: "string" }) {
  static table = "references_by_label";
}

// Text linked to a number key is cast to the key's own type, so Postgres searches the key's
// index rather than casting its column (#618).
describe("text linked to a number key", () => {
  let schema: PgSchema;
  const db = () => connect(schema.url);

  beforeAll(async () => {
    schema = await openPgSchema([]);
    await schema.pool.query({
      text: `CREATE TABLE targets (id BIGINT PRIMARY KEY, ratio DOUBLE PRECISION, amount NUMERIC(10, 2));
        CREATE INDEX targets_ratio ON targets (ratio);
        CREATE INDEX targets_amount ON targets (amount);
        CREATE TABLE references_by_label (id BIGINT PRIMARY KEY, label TEXT);`,
    });
  });
  afterAll(() => schema.dispose());

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

  test.each(["byId", "byRatio", "byAmount"] as const)(
    "a join through %s searches the key's index",
    async (association) => {
      const plan = await planOf(db().model(Target).joins(association).toSql());

      expect(plan).toMatch(/Index (Only )?Scan using targets_\w+ on targets/);
    },
  );
});
