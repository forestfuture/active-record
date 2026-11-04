// A database's migrations: the files Wrangler finds, in the order it applies them.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { slashed } from "./paths.ts";
import type { Target } from "./targets.ts";

export interface Migration {
  /** The file's name, as Wrangler orders and records it. */
  name: string;
  sql: string;
}

/** Plain character order, the same on every machine (unlike `localeCompare`). */
export function byName(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A database's migrations, in the order Wrangler applies them: by file name. */
export function migrationsOf(target: Target): Migration[] {
  const { migrationsPattern } = target.database;
  const files =
    migrationsPattern === undefined
      ? readdirSync(target.migrationsDir).filter((name) => name.endsWith(".sql"))
      : // Loaded when used (Node 22+), so an older Node gets the command's own message (cli/main.ts).
        process
          .getBuiltinModule("node:fs")
          .globSync(migrationsPattern, { cwd: target.configDir })
          .map((path) => slashed(relative(target.migrationsDir, join(target.configDir, path))));
  return files
    .sort(byName)
    .map((name) => ({ name, sql: readFileSync(join(target.migrationsDir, name), "utf8") }));
}

/**
 * Whether a database's migrations are in folders (`migrations/0000_init/migration.sql`, as
 * Drizzle writes them) with no `migrations_pattern` in the config to find them.
 */
export function hasNestedMigrations(target: Target): boolean {
  const dir = target.migrationsDir;
  if (target.database.migrationsPattern !== undefined || !existsSync(dir)) return false;
  const entries = readdirSync(dir, { withFileTypes: true });
  if (entries.some((entry) => entry.isFile() && entry.name.endsWith(".sql"))) return false;
  return entries.some(
    (entry) => entry.isDirectory() && existsSync(join(dir, entry.name, "migration.sql")),
  );
}
