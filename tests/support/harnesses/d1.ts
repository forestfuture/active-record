// The conformance suite's D1 harness: an in-memory Miniflare D1 per file, as tests/support/d1.ts makes.
import { d1Adapter } from "../../../packages/active-record/src/adapters/d1/adapter.ts";
import { D1Driver } from "../../../packages/active-record/src/adapters/d1/driver.ts";
import { AnyDatabase } from "../../../packages/active-record/src/database.ts";
import { DatabaseExecutor } from "../../../packages/active-record/src/executor.ts";
import { connect } from "../../../packages/active-record/src/adapters/d1/index.ts";
import { createTestDatabase } from "../d1.ts";
import type { Harness, SchemaName } from "../harness.ts";

const sqlite = (name: string) => new URL(`../../fixtures/sqlite/${name}.sql`, import.meta.url);
// The schema D1's own tests use, also a Wrangler fixture's migration, and the suite's own tables.
const fixture = [
  new URL("../../fixtures/migrations/db/0001_schema.sql", import.meta.url),
  sqlite("conformance"),
];

/** Each schema's SQLite migrations, applied in order. */
const schemas: Record<SchemaName, readonly URL[]> = {
  fixture,
  "generated-ids": [sqlite("generated-ids")],
  paginated: [...fixture, sqlite("paginated")],
};

export async function openD1Harness(schema: SchemaName): Promise<Harness> {
  const { db, dispose } = await createTestDatabase(schemas[schema]);
  return {
    adapter: "d1",
    connect({ onQuery, driver } = {}) {
      if (driver === undefined) return connect(db, { onQuery });
      return new AnyDatabase(new DatabaseExecutor(d1Adapter, driver(new D1Driver(db)), onQuery));
    },
    asSent: (sql) => sql,
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
