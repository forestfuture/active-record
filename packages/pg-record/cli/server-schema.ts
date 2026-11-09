// A database of its own on a Postgres server, for reading a schema whose migrations need an extension PGlite can't load.
import { randomUUID } from "node:crypto";
import { connected, type Client } from "./client.ts";
import type { Scratch } from "./schema.ts";

/**
 * The same server's connection string, for another database on it; undefined when Node can't read
 * it as a URL (a socket's `postgres://app@/shop`), whose message would show it, password and all.
 */
function urlForDatabase(url: string, name: string): string | undefined {
  try {
    const target = new URL(url);
    target.pathname = `/${name}`;
    return target.toString();
  } catch {
    return undefined;
  }
}

/** Why the url can't name another database on its server. */
const unreadableUrl =
  "the database's url can't be read as a URL; write it as postgres://user:password@host/database";

/** Drops the temporary database and ends the admin client, which ends even when the drop fails. */
async function dropped(admin: Client, name: string): Promise<void> {
  try {
    await admin.query({ text: `DROP DATABASE IF EXISTS ${name} WITH (FORCE)` });
  } finally {
    await admin.end();
  }
}

/** Creates the database, or says why it couldn't, and ends the admin client then. */
async function created(admin: Client, name: string): Promise<string | undefined> {
  try {
    await admin.query({ text: `CREATE DATABASE ${name}` });
    return undefined;
  } catch (error) {
    await admin.end();
    return (error as Error).message;
  }
}

/**
 * A new, empty database on the server `url` names, which closing drops; or why there's none. The
 * migrations then create their extensions there, as they would on the real database.
 */
export async function temporaryDatabase(url: string): Promise<Scratch | string> {
  const name = `active_record_schema_${randomUUID().replaceAll("-", "")}`;
  const target = urlForDatabase(url, name);
  if (target === undefined) return unreadableUrl;
  const admin = await connected(url);
  if (typeof admin === "string") return admin;
  const refusal = await created(admin, name);
  if (refusal !== undefined) return refusal;
  const client = await connected(target);
  if (typeof client === "string") {
    await dropped(admin, name);
    return client;
  }
  return {
    exec: async (sql) => void (await client.query({ text: sql })),
    query: async (sql) => (await client.query({ text: sql })).rows,
    close: async () => {
      await client.end();
      await dropped(admin, name);
    },
  };
}
