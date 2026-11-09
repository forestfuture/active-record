// A database's migrations: its SQL files, in the order they're applied in, by their leading numbers.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, relative } from "node:path";
import { slashed } from "./paths.ts";
import type { Target } from "./targets.ts";

export interface Migration {
  /** The file's name, relative to the migrations folder, which orders it. */
  name: string;
  sql: string;
}

/** Plain character order, the same on every machine (unlike `localeCompare`). */
export function byName(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

/** A migration path's leading number (`0009_x.sql`, `20261108090503_x/migration.sql`), before its first `_`; NaN for none. */
export function leadingNumber(path: string): number {
  return Number.parseInt(path.split("/")[0]!.split("_")[0]!, 10);
}

/**
 * Migrations in the order they're applied, as migration tools order them: by their leading
 * numbers (`9_…` before `10_…`), those without one after them, and by name between equals.
 */
export function byVersion(a: string, b: string): number {
  const [left, right] = [leadingNumber(a), leadingNumber(b)];
  if (left === right || (Number.isNaN(left) && Number.isNaN(right))) return byName(a, b);
  if (Number.isNaN(left)) return 1;
  return Number.isNaN(right) ? -1 : left - right;
}

/** A database's migrations, in the order they're applied: by version. */
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
    .sort(byVersion)
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
