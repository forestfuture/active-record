import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { Model } from "../../../packages/arbor/src/index.ts";
import { connect } from "../../../packages/arbor/src/adapters/postgresql/index.ts";
import { openPgSchema, type PgSchema } from "../../support/pg.ts";

class Setting extends Model.define({
  id: { type: "integer", null: false },
  value: "json",
  updatedAt: "datetime",
}) {
  static table = "settings";
}

const past = new Date("2020-01-01T00:00:00.000Z");

// What only Postgres has: a `json` column, whose values have no equality operator.
describe("an upsert on Postgres (#36)", () => {
  let schema: PgSchema;
  const settings = () => connect(schema.url).model(Setting);

  beforeAll(async () => {
    schema = await openPgSchema();
    await schema.pool.query({
      text: "CREATE TABLE settings (id BIGINT PRIMARY KEY, value JSON, updated_at TIMESTAMPTZ)",
    });
  });
  afterAll(() => schema.dispose());

  test("compares a json column's values to keep updatedAt, and sets it when one changes", async () => {
    await settings().insert({ id: 1, value: { theme: "dark" }, updatedAt: past });
    await settings().insert({ id: 2, value: { theme: "dark" }, updatedAt: past });

    await settings().upsertAll([
      { id: 1, value: { theme: "dark" } },
      { id: 2, value: { theme: "light" } },
    ]);

    const [kept, changed] = await settings().order({ id: "asc" }).toArray();
    expect(kept!.updatedAt).toEqual(past);
    expect(changed!.updatedAt).not.toEqual(past);
    expect(changed!.value).toEqual({ theme: "light" });
  });
});
