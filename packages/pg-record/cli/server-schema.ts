// A database of its own on a Postgres server, for reading a schema whose migrations need an extension PGlite can't load.
import { randomUUID } from "node:crypto";
import pg from "pg";
import type { Scratch } from "./schema.ts";

/** A client on the server, connected, or why it couldn't be. */
async function connected(
  connectionString: string,
): Promise<InstanceType<typeof pg.Client> | string> {
  const client = new pg.Client({ connectionString, connectionTimeoutMillis: 10_000 });
  client.on("error", () => {});
  try {
    await client.connect();
    return client;
  } catch (error) {
    return (error as Error).message;
  }
}

/** The same server's connection string, for another database on it. */
function onDatabase(url: string, name: string): string {
  const target = new URL(url);
  target.pathname = `/${name}`;
  return target.toString();
}

/**
 * A new, empty database on the server `url` names, which closing drops; or why there's none. The
 * migrations then create their extensions there, as they would on the real database.
 */
export async function temporaryDatabase(url: string): Promise<Scratch | string> {
  const admin = await connected(url);
  if (typeof admin === "string") return admin;
  const name = `active_record_schema_${randomUUID().replaceAll("-", "")}`;
  const drop = async () => {
    await admin.query({ text: `DROP DATABASE IF EXISTS ${name} WITH (FORCE)` });
    await admin.end();
  };
  try {
    await admin.query({ text: `CREATE DATABASE ${name}` });
  } catch (error) {
    await admin.end();
    return (error as Error).message;
  }
  const client = await connected(onDatabase(url, name));
  if (typeof client === "string") {
    await drop();
    return client;
  }
  return {
    exec: async (sql) => void (await client.query({ text: sql })),
    query: async (sql) => (await client.query({ text: sql })).rows,
    close: async () => {
      await client.end();
      await drop();
    },
  };
}
