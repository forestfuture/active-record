// The migration runner: applies a database's pending migrations in order, each in a transaction with its version, recorded in `schema_migrations`.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { byName } from "@forestfuture/active-record/cli";
import pg from "pg";
import { migrationsTable } from "./config.ts";
import { hostOf } from "./urls.ts";

/** A migration file, and the version its name starts with. */
interface Pending {
  file: string;
  version: string;
  sql: string;
}

type Client = InstanceType<typeof pg.Client>;

/** The migrations folder's files in the order they're applied (by name), or why they can't be. */
export function migrationFiles(dir: string): Pending[] | string {
  let names: string[];
  try {
    names = readdirSync(dir).filter((name) => name.endsWith(".sql"));
  } catch {
    return `No migrations folder at ${dir}`;
  }
  const files: Pending[] = [];
  for (const file of names.sort(byName)) {
    const version = /^(\d+)/.exec(file)?.[1];
    if (version === undefined) {
      return `${file} has no version: start its name with one, as the generators do (20261108090503_create_products.sql)`;
    }
    files.push({ file, version, sql: readFileSync(join(dir, file), "utf8") });
  }
  return files;
}

/** One lock per database and schema, so two runs at once take turns. */
const lock = `hashtext('active-record migrate ' || current_database() || '.' || current_schema())`;

/** The versions already applied, once the table that records them is there. */
async function appliedVersions(client: Client): Promise<Set<string>> {
  await client.query({
    text: `CREATE TABLE IF NOT EXISTS ${migrationsTable} (version TEXT PRIMARY KEY)`,
  });
  const { rows } = await client.query({ text: `SELECT version FROM ${migrationsTable}` });
  return new Set(rows.map((row) => String(row["version"])));
}

/** Applies one migration and records its version, in one transaction; why it failed, if it did. */
async function applyOne(client: Client, { sql, version }: Pending): Promise<string | undefined> {
  try {
    await client.query({ text: "BEGIN" });
    await client.query({ text: sql });
    await client.query({
      text: `INSERT INTO ${migrationsTable} (version) VALUES ($1)`,
      values: [version],
    });
    await client.query({ text: "COMMIT" });
    return undefined;
  } catch (error) {
    await client.query({ text: "ROLLBACK" }).catch(() => {});
    return (error as Error).message;
  }
}

/** Applies the files not applied yet, saying each; false once one fails, and none after it run. */
async function applyPending(
  client: Client,
  files: readonly Pending[],
  say: (line: string) => void,
) {
  const applied = await appliedVersions(client);
  const pending = files.filter((file) => !applied.has(file.version));
  if (pending.length === 0) say("No migrations to apply");
  for (const file of pending) {
    const failure = await applyOne(client, file);
    if (failure !== undefined) {
      say(`${file.file} failed: ${failure}`);
      return false;
    }
    say(`Applied ${file.file}`);
  }
  return true;
}

/**
 * Applies the folder's pending migrations to the database `url` names, holding an advisory lock
 * while it does. What it does goes to `say`; it resolves to the exit code.
 */
export async function runMigrations(
  url: string,
  files: readonly Pending[],
  say: (line: string) => void,
): Promise<number> {
  const client = new pg.Client({ connectionString: url, connectionTimeoutMillis: 10_000 });
  client.on("error", () => {});
  try {
    await client.connect();
  } catch (error) {
    say(`Couldn't connect to ${hostOf(url)}: ${(error as Error).message}`);
    return 1;
  }
  try {
    await client.query({ text: `SELECT pg_advisory_lock(${lock})` });
    return (await applyPending(client, files, say)) ? 0 : 1;
  } finally {
    await client.end();
  }
}
