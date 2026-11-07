// A Postgres schema of its own for one of pg-record's test files, on the server DATABASE_URL names.
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { userInfo } from "node:os";
import pg from "pg";

const fixture = [
  new URL("../fixtures/postgres/fixture.sql", import.meta.url),
  new URL("../fixtures/postgres/clients.sql", import.meta.url),
];

/** The server the Postgres projects run against. */
function databaseUrl(): string {
  const url = process.env["DATABASE_URL"];
  if (url === undefined) throw new Error("The Postgres projects need DATABASE_URL");
  return url;
}

export interface PgSchema {
  /** A connection string to it, whose connections Postgres lists under this file's own name. */
  url: string;
  /** A Pool on it, for the test's own reads. */
  pool: InstanceType<typeof pg.Pool>;
  /** How many connections `url`'s clients have open now. */
  connections(): Promise<number>;
  /** The queries `url`'s clients are running now. */
  running(): Promise<string[]>;
  dispose(): Promise<void>;
}

/** Creates a schema with the fixture tables (and `schema`'s, after them). Dispose in `afterAll`. */
export async function openPgSchema(schema: readonly URL[] = fixture): Promise<PgSchema> {
  const name = `record_${randomUUID().replaceAll("-", "")}`;
  const url = new URL(databaseUrl());
  // Node's pg falls back to the OS user, as libpq does; a Worker has none to fall back to.
  if (url.username === "") url.username = userInfo().username;
  url.searchParams.set("options", `-c search_path=${name}`);
  url.searchParams.set("application_name", name);
  const pool = new pg.Pool({ connectionString: databaseUrl(), options: `-c search_path=${name}` });
  pool.on("error", () => {});
  await pool.query({ text: `CREATE SCHEMA ${name}` });
  for (const file of schema) await pool.query({ text: readFileSync(file, "utf8") });
  return {
    url: url.toString(),
    pool,
    async connections() {
      const { rows } = await pool.query({
        text: "SELECT count(*)::int AS open FROM pg_stat_activity WHERE application_name = $1",
        values: [name],
      });
      return rows[0]!["open"] as number;
    },
    async running() {
      const { rows } = await pool.query({
        text: "SELECT query FROM pg_stat_activity WHERE application_name = $1 AND state = 'active'",
        values: [name],
      });
      return rows.map((row) => row["query"] as string);
    },
    async dispose() {
      await pool.query({ text: `DROP SCHEMA ${name} CASCADE` });
      await pool.end();
    },
  };
}
