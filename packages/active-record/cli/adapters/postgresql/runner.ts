// The migration runner: applies a database's pending migrations in order, each in a transaction with its version, recorded in `schema_migrations`.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { connected, type Client } from "./client.ts";
import { migrationsTable } from "./config.ts";
import { hostOf } from "./urls.ts";
import { ownTransactions } from "./transaction-control.ts";
import { versionsOf } from "./versions.ts";

/** A migration file, and the version its name starts with. */
interface MigrationFile {
  file: string;
  version: string;
  sql: string;
}

/** The migrations folder's files in the order they're applied (by version), or why they can't be. */
export function migrationFiles(dir: string): MigrationFile[] | string {
  let names: string[];
  try {
    names = readdirSync(dir).filter((name) => name.endsWith(".sql"));
  } catch {
    return `No migrations folder at ${dir}`;
  }
  const versions = versionsOf(names);
  if (typeof versions === "string") return versions;
  const files = [...versions].map(([file, version]) => ({
    file,
    version,
    sql: readFileSync(join(dir, file), "utf8"),
  }));
  return ownTransactions(files.map(({ file, sql }) => ({ name: file, sql }))) ?? files;
}

/** One lock per database and schema: a run while another holds it is refused, as Rails refuses it. */
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
async function applyOne(
  client: Client,
  { sql, version }: MigrationFile,
): Promise<string | undefined> {
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
  files: readonly MigrationFile[],
  say: (line: string) => void,
) {
  const applied = await appliedVersions(client).catch((error: unknown) => error as Error);
  if (applied instanceof Error) {
    say(`Couldn't read ${migrationsTable}: ${applied.message}`);
    return false;
  }
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
  files: readonly MigrationFile[],
  say: (line: string) => void,
): Promise<number> {
  const client = await connected(url);
  if (typeof client === "string") {
    say(`Couldn't connect to ${hostOf(url)}: ${client}`);
    return 1;
  }
  try {
    const { rows } = await client.query({ text: `SELECT pg_try_advisory_lock(${lock}) AS locked` });
    if (rows[0]?.["locked"] !== true) {
      say("Another migrate is running on this database; run it again once that one's done");
      return 1;
    }
    return (await applyPending(client, files, say)) ? 0 : 1;
  } catch (error) {
    say(`Couldn't take the migrations' lock: ${(error as Error).message}`);
    return 1;
  } finally {
    await client.end();
  }
}
