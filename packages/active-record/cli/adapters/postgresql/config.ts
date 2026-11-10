// Reads a project's Postgres databases from its `active-record.jsonc`: each one's binding, migrations folder and connection strings.
import { basename } from "node:path";
import type {
  ConfigResult,
  DatabaseConfig,
  ProjectDatabases,
} from "@forestfuture/active-record/cli";

/** The table the runner records applied migrations in, left out of the schema. */
export const migrationsTable = "schema_migrations";

/** The settings a database's entry may have, each a string. */
export const stringSettings = ["migrationsDir", "url", "remoteUrl", "schemaUrl"] as const;

/** Why a database's entry won't do, if it won't. */
function entryError(binding: string, entry: Record<string, unknown>): string | undefined {
  const wrong = stringSettings.find((key) => key in entry && typeof entry[key] !== "string");
  return wrong === undefined ? undefined : `databases.${binding}.${wrong} isn't a string`;
}

/** An entry as a database: its binding, and its migrations' folder and table. */
function databaseOf(binding: string, entry: Record<string, unknown>): DatabaseConfig {
  const migrationsDir =
    typeof entry.migrationsDir === "string" ? entry.migrationsDir : "migrations";
  return { binding, migrationsDir, migrationsTable, entry };
}

/**
 * The Postgres databases a project's `active-record.jsonc` declares, by binding:
 * `{ "databases": { "HYPERDRIVE": { "adapter": "postgresql", "url": "postgres://localhost/shop" } } }`.
 */
export function readDatabases(project: ProjectDatabases): ConfigResult {
  const name = basename(project.file);
  const entries = Object.entries(project.databases);
  for (const [binding, entry] of entries) {
    const error = entryError(binding, entry);
    if (error !== undefined) return { ok: false, error: `${name}: ${error}` };
  }
  return {
    ok: true,
    file: project.file,
    dir: project.dir,
    databases: entries.map(([binding, entry]) => databaseOf(binding, entry)),
  };
}
