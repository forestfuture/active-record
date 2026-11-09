// A Postgres schema, or a database, of its own for one of the PostgreSQL adapter's test files, on the server DATABASE_URL names.
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

/** A name of its own, for a schema or a database. */
const ownName = () => `record_${randomUUID().replaceAll("-", "")}`;

/** The server's URL, naming its user: Node's pg falls back to the OS user, as libpq does, and a Worker has none to fall back to. */
function urlWithUser(): URL {
  const url = new URL(databaseUrl());
  if (url.username === "") url.username = userInfo().username;
  return url;
}

/** A Pool whose idle clients' errors, such as a dropped database's, don't fail the test. */
function quietPool(config: ConstructorParameters<typeof pg.Pool>[0]): InstanceType<typeof pg.Pool> {
  const pool = new pg.Pool(config);
  pool.on("error", () => {});
  return pool;
}

export interface PgSchema {
  /** A connection string to it, whose connections Postgres lists under this file's own name. */
  url: string;
  /** A Pool on it, for the test's own reads. */
  pool: InstanceType<typeof pg.Pool>;
  /** How many connections `url`'s clients have open now. */
  connections(): Promise<number>;
  /** The queries `url`'s clients are running now, each with its backend's id. */
  running(): Promise<{ backend: number; query: string }[]>;
  dispose(): Promise<void>;
}

/** Creates a schema with the fixture tables (and `schema`'s, after them). Dispose in `afterAll`. */
export async function openPgSchema(schema: readonly URL[] = fixture): Promise<PgSchema> {
  const name = ownName();
  const url = urlWithUser();
  url.searchParams.set("options", `-c search_path=${name}`);
  url.searchParams.set("application_name", name);
  const pool = quietPool({ connectionString: databaseUrl(), options: `-c search_path=${name}` });
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
        text: "SELECT pid, query FROM pg_stat_activity WHERE application_name = $1 AND state = 'active'",
        values: [name],
      });
      return rows.map((row) => ({ backend: row["pid"] as number, query: row["query"] as string }));
    },
    async dispose() {
      await pool.query({ text: `DROP SCHEMA ${name} CASCADE` });
      await pool.end();
    },
  };
}

export interface PgDatabase {
  /** A connection string to it, with nothing but the database to choose (no `options`). */
  url: string;
  /** A Pool on it, for the test's own reads. */
  pool: InstanceType<typeof pg.Pool>;
  dispose(): Promise<void>;
}

/**
 * A database of its own on DATABASE_URL's server, for a client that passes on only a URL's
 * database, as Hyperdrive does, and so can't be given a schema. Dispose in `afterAll`.
 */
export async function openPgDatabase(): Promise<PgDatabase> {
  const name = ownName();
  const admin = quietPool({ connectionString: databaseUrl() });
  await admin.query({ text: `CREATE DATABASE ${name}` });
  const url = urlWithUser();
  url.pathname = `/${name}`;
  const pool = quietPool({ connectionString: url.toString() });
  return {
    url: url.toString(),
    pool,
    async dispose() {
      await pool.end();
      await admin.query({ text: `DROP DATABASE ${name} WITH (FORCE)` });
      await admin.end();
    },
  };
}
