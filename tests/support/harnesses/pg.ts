// The conformance suite's Postgres harness: a schema of its own per file, on the server DATABASE_URL names.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import pg from "pg";
import { AnyDatabase } from "../../../packages/active-record/src/database.ts";
import { DatabaseExecutor } from "../../../packages/active-record/src/executor.ts";
import { pgAdapter } from "../../../packages/pg-record/src/adapter.ts";
import { PoolClients } from "../../../packages/pg-record/src/clients.ts";
import { PgDriver } from "../../../packages/pg-record/src/driver.ts";
import { connect } from "../../../packages/pg-record/src/index.ts";
import { typeParsers } from "../../../packages/pg-record/src/type-parsers.ts";
import type { Harness, SchemaName } from "../harness.ts";

const postgres = (name: string) => new URL(`../../fixtures/postgres/${name}.sql`, import.meta.url);
const fixture = [postgres("fixture"), postgres("conformance")];

/** Each schema's Postgres migrations, applied in order. */
const schemas: Record<SchemaName, readonly URL[]> = {
  fixture,
  "generated-ids": [postgres("generated-ids")],
  paginated: [...fixture, postgres("paginated")],
};

/** The server the Postgres projects run against. */
export function databaseUrl(): string {
  const url = process.env["DATABASE_URL"];
  if (url === undefined) throw new Error("The Postgres projects need DATABASE_URL");
  return url;
}

/** `?` placeholders as Postgres's `$1`, `$2`, …, leaving quoted text and identifiers alone. */
function numbered(sql: string): string {
  let index = 0;
  let quote: string | undefined;
  let out = "";
  for (const char of sql) {
    if (quote !== undefined) quote = char === quote ? undefined : quote;
    else if (char === "'" || char === '"') quote = char;
    out += char === "?" && quote === undefined ? `$${++index}` : char;
  }
  return out;
}

/** The table an `INSERT` seeds, if `sql` is one. */
const insertedInto = (sql: string) => /^\s*INSERT\s+INTO\s+"?(\w+)"?/i.exec(sql)?.[1];

/**
 * Moves `table`'s key identity past its rows (back to 1 when it has none), as SQLite's next key
 * is past the largest, so a test that seeds rows with their own keys can still create records.
 */
async function pastSeededKeys(pool: InstanceType<typeof pg.Pool>, table: string): Promise<void> {
  await pool.query({
    text:
      "SELECT setval(sequence::regclass, coalesce(largest, 1)::bigint, largest IS NOT NULL) FROM (SELECT " +
      "pg_get_serial_sequence($1, 'id') AS sequence, " +
      `(SELECT max(id::text::numeric) FROM "${table}" WHERE id::text ~ '^[0-9]+$') AS largest) AS keys ` +
      "WHERE sequence IS NOT NULL",
    values: [table],
  });
}

export async function openPgHarness(schema: SchemaName): Promise<Harness> {
  const name = `conformance_${randomUUID().replaceAll("-", "")}`;
  const admin = new pg.Pool({ connectionString: databaseUrl(), max: 1 });
  await admin.query({ text: `CREATE SCHEMA ${name}` });
  await admin.end();
  const pool = new pg.Pool({ connectionString: databaseUrl(), options: `-c search_path=${name}` });
  pool.on("error", () => {});
  for (const file of schemas[schema]) await pool.query({ text: readFileSync(file, "utf8") });
  return {
    adapter: "pg",
    connect({ onQuery, driver } = {}) {
      if (driver === undefined) return connect(pool, { onQuery });
      const own = driver(new PgDriver(new PoolClients(pool)));
      return new AnyDatabase(new DatabaseExecutor(pgAdapter, own, onQuery));
    },
    asSent: numbered,
    async exec(sql, params = []) {
      const values = [...params];
      const { rows } = await pool.query({ text: numbered(sql), values, types: typeParsers });
      const table = insertedInto(sql);
      if (table !== undefined) await pastSeededKeys(pool, table);
      return rows;
    },
    async reset(...tables) {
      if (tables.length === 0) return;
      // In order, as D1's harness deletes: TRUNCATE refuses a table another references.
      for (const table of tables) {
        await pool.query({ text: `DELETE FROM "${table}"` });
        await pastSeededKeys(pool, table);
      }
    },
    async dispose() {
      await pool.query({ text: `DROP SCHEMA ${name} CASCADE` });
      await pool.end();
    },
  };
}
