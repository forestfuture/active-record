// Reads a project's Postgres databases from its `active-record.jsonc`: each one's binding, migrations folder and connection strings.
import { basename } from "node:path";
import {
  configFileName,
  readProjectConfig,
  type ConfigResult,
  type DatabaseConfig,
} from "@forestfuture/active-record/cli";

/** The table the runner records applied migrations in, left out of the schema. */
export const migrationsTable = "schema_migrations";

/** The settings a database's entry may have, each a string. */
const stringSettings = ["migrationsDir", "url", "remoteUrl", "schemaUrl"] as const;

const isObject = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

/** Why a database's entry won't do, if it won't. */
function entryError(binding: string, entry: unknown): string | undefined {
  if (!isObject(entry)) return `databases.${binding} isn't an object`;
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
 * The Postgres databases in a project's `active-record.jsonc` (or the file `--config` names), by
 * binding: `{ "databases": { "HYPERDRIVE": { "url": "postgres://localhost/shop" } } }`.
 */
export function readDatabases(cwd: string, configPath?: string): ConfigResult {
  const config = readProjectConfig(cwd, configPath);
  if (config === undefined) {
    return {
      ok: false,
      error: `No ${configFileName} here, which declares the Postgres databases (pass --config)`,
    };
  }
  if (typeof config === "string") return { ok: false, error: config };
  const name = basename(config.file);
  const databases = config.settings.databases;
  if (!isObject(databases) || Object.keys(databases).length === 0) {
    return { ok: false, error: `${name} has no databases` };
  }
  for (const [binding, entry] of Object.entries(databases)) {
    const error = entryError(binding, entry);
    if (error !== undefined) return { ok: false, error: `${name}: ${error}` };
  }
  const entries = Object.entries(databases as Record<string, Record<string, unknown>>);
  return {
    ok: true,
    file: config.file,
    dir: config.dir,
    databases: entries.map(([binding, entry]) => databaseOf(binding, entry)),
  };
}
