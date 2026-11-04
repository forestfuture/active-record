// The conformance suite's D1 harness: an in-memory Miniflare D1 per file, as tests/support/d1.ts makes.
import { connect } from "../../../src/index.ts";
import { createTestDatabase } from "../d1.ts";
import type { Harness, SchemaName } from "../harness.ts";

const fixture = new URL("../../fixtures/migrations/db/0001_schema.sql", import.meta.url);

/** Each schema's SQLite migrations, applied in order. */
const schemas: Record<SchemaName, readonly URL[]> = {
  fixture: [fixture],
  "generated-ids": [new URL("../../fixtures/sqlite/generated-ids.sql", import.meta.url)],
};

export async function openD1Harness(schema: SchemaName): Promise<Harness> {
  const { db, dispose } = await createTestDatabase(schemas[schema]);
  return {
    adapter: "d1",
    connect: (options = {}) => connect(db, options),
    async exec(sql, params = []) {
      const { results } = await db
        .prepare(sql)
        .bind(...params)
        .all<Record<string, unknown>>();
      return results;
    },
    async reset(...tables) {
      if (tables.length === 0) return;
      await db.batch(tables.map((table) => db.prepare(`DELETE FROM "${table}"`)));
    },
    dispose,
  };
}
