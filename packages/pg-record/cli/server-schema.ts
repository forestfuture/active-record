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
  "the database's schemaUrl can't be read as a URL; write it as postgres://user:password@host/database";

/** Drops the temporary database and ends the admin client, which ends even when the drop fails. */
async function dropped(admin: Client, name: string): Promise<void> {
  try {
    await admin.query({ text: `DROP DATABASE IF EXISTS ${name} WITH (FORCE)` });
  } finally {
    await admin.end();
  }
}

/** Creates the database, or says why it couldn't. */
async function created(admin: Client, name: string): Promise<string | undefined> {
  try {
    await admin.query({ text: `CREATE DATABASE ${name}` });
    return undefined;
  } catch (error) {
    return (error as Error).message;
  }
}

/** The signals a person stops a command with: Ctrl-C, and a terminal's or a process manager's. */
const stops = ["SIGINT", "SIGTERM", "SIGHUP"] as const;

/** Each temporary database there now, by its drop, which runs once however often it's called. */
const open = new Set<() => Promise<void>>();

/** Drops every temporary database there, then stops the command as the signal would have. */
function onSignal(signal: NodeJS.Signals): void {
  for (const stop of stops) process.off(stop, onSignal);
  void Promise.allSettled([...open].map((drop) => drop())).finally(() =>
    process.kill(process.pid, signal),
  );
}

/**
 * Keeps a temporary database's drop while it's there, so a signal that stops the command drops
 * it first (every one, when several databases are read at once); returns the drop, run once.
 */
function tracked(drop: () => Promise<void>): () => Promise<void> {
  let running: Promise<void> | undefined;
  const once = () => (running ??= drop());
  if (open.size === 0) for (const stop of stops) process.on(stop, onSignal);
  open.add(once);
  return async () => {
    open.delete(once);
    if (open.size === 0) for (const stop of stops) process.off(stop, onSignal);
    await once();
  };
}

/** Starts the one transaction the migrations run in, or says why it couldn't, ending the client. */
async function begun(client: Client): Promise<string | undefined> {
  try {
    await client.query({ text: "BEGIN" });
    return undefined;
  } catch (error) {
    await client.end().catch(() => {});
    return (error as Error).message;
  }
}

/**
 * A new, empty database on the server `url` names, which closing drops; or why there's none. The
 * migrations then create their extensions there, as they would on the real database, in one
 * transaction that closing rolls back.
 */
export async function temporaryDatabase(url: string): Promise<Scratch | string> {
  const name = `active_record_schema_${randomUUID().replaceAll("-", "")}`;
  const target = urlForDatabase(url, name);
  if (target === undefined) return unreadableUrl;
  const admin = await connected(url);
  if (typeof admin === "string") return admin;
  // Tracked before it's made: the server shows it before the command hears it was, and a Ctrl-C
  // then still drops it (after the CREATE, on the same client).
  const drop = tracked(() => dropped(admin, name));
  const refusal = await created(admin, name);
  if (refusal !== undefined) {
    await drop().catch(() => {});
    return refusal;
  }
  const client = await connected(target);
  if (typeof client === "string") {
    await drop();
    return client;
  }
  // One transaction, never committed: what a migration does beyond the database (a role) is undone.
  const failure = await begun(client);
  if (failure !== undefined) {
    await drop();
    return failure;
  }
  return {
    exec: async (sql) => void (await client.query({ text: sql })),
    query: async (sql) => (await client.query({ text: sql })).rows,
    close: async () => {
      try {
        await client.query({ text: "ROLLBACK" });
      } finally {
        // A signal's drop may have ended this connection already.
        await client.end().catch(() => {});
        await drop();
      }
    },
  };
}
