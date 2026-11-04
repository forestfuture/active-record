// A project read from disk once: each database's migrations and generated files.
// One per D1 database. Commands plan from a snapshot, so what they decide is testable without a
// folder on disk (#95).
import { existsSync, readFileSync, statSync } from "node:fs";
import { hasNestedMigrations, migrationsOf, type Migration } from "./migrations.ts";
import { targetsOf, type ProjectOptions, type Target } from "./targets.ts";
import { toolsWithFiles, type Tool } from "./tools.ts";

/** A Model built on a database's base class, as its files define it. */
export interface FoundModel {
  className: string;
  /** Its table: from its class name, or its `static table`. */
  table: string;
  /** The file that declares it. */
  file: string;
}

/** One D1 database, and what's on disk for it. */
export interface DatabaseSnapshot {
  target: Target;
  /** Its migrations, in the order Wrangler applies them; undefined with no migrations folder. */
  migrations?: Migration[];
  /** The schema file as it is, when there's one. */
  schema?: string;
  /** Whether a folder has the schema file's name, less `.ts` (`src/db/schema/`). */
  schemaFolder: boolean;
  /** Whether the app's base class file exists. */
  hasBase: boolean;
  /** Whether its migrations are in folders, with no `migrations_pattern` to find them. */
  nestedMigrations: boolean;
  /** The tools (Drizzle, Prisma) whose files are in the project or above it. */
  toolsFound: Tool[];
  /** Its Models, found by loading the Model files (none until they're loaded). */
  models: FoundModel[];
  /** Why the Model files couldn't be read: a file that won't load, or a Model with no table. */
  modelErrors: string[];
}

/** A project: its databases, and any other files a command asked for, by path. */
export interface ProjectSnapshot {
  cwd: string;
  databases: DatabaseSnapshot[];
  /** The contents of the other files asked for that exist. */
  files: ReadonlyMap<string, string>;
}

/** A file's contents, or undefined when there's no such file. */
function contents(path: string): string | undefined {
  return existsSync(path) ? readFileSync(path, "utf8") : undefined;
}

/** What's on disk for one database. */
function databaseSnapshot(target: Target, toolsFound: Tool[]): DatabaseSnapshot {
  const folder = target.out.replace(/\.ts$/, "");
  return {
    target,
    migrations: existsSync(target.migrationsDir) ? migrationsOf(target) : undefined,
    schema: contents(target.out),
    schemaFolder: existsSync(folder) && statSync(folder).isDirectory(),
    hasBase: existsSync(target.base.path),
    nestedMigrations: hasNestedMigrations(target),
    toolsFound,
    models: [],
    modelErrors: [],
  };
}

/**
 * Reads a project's databases from its Wrangler config, and the other `files` a command needs
 * (a Model file, for `g model`); or why it can't, such as a missing config.
 */
export function readProject(
  cwd: string,
  options: ProjectOptions,
  files: readonly string[] = [],
): ProjectSnapshot | string {
  const targets = targetsOf(cwd, options);
  if (typeof targets === "string") return targets;
  const toolsFound = targets.length === 0 ? [] : toolsWithFiles(targets[0]!.configDir);
  const read = files.flatMap((path) => {
    const text = contents(path);
    return text === undefined ? [] : [[path, text] as const];
  });
  return {
    cwd,
    databases: targets.map((target) => databaseSnapshot(target, toolsFound)),
    files: new Map(read),
  };
}
