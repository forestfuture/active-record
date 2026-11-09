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

/** Two segments of migration paths: by their leading numbers, numbered first, then by name. */
function bySegment(a: string, b: string): number {
  const [left, right] = [leadingNumber(a), leadingNumber(b)];
  const [leftNumbered, rightNumbered] = [Number.isFinite(left), Number.isFinite(right)];
  if (leftNumbered && rightNumbered && left !== right) return left - right;
  if (leftNumbered !== rightNumbered) return leftNumbered ? -1 : 1;
  return byName(a, b);
}

/**
 * Migrations in the order they're applied, as migration tools order them: folder by folder, by
 * their leading numbers (`9_…` before `10_…`), those without one after them, and by name between
 * equals; a path that's the start of another comes first.
 */
export function byVersion(a: string, b: string): number {
  const [left, right] = [a.split("/"), b.split("/")];
  for (let index = 0; index < Math.min(left.length, right.length); index++) {
    const order = bySegment(left[index]!, right[index]!);
    if (order !== 0) return order;
  }
  return left.length - right.length;
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
