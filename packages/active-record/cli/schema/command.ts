// `active-record schema`: plans the generated schema for each database, and `--watch`.
import { watch } from "node:fs";
import { resolve } from "node:path";
import { apply, combined, printing, type Plan, type Print } from "../plan.ts";
import { shown } from "../project/paths.ts";
import { loadAdapter } from "../project/adapters.ts";
import { readProject, type DatabaseSnapshot, type ProjectSnapshot } from "../project/snapshot.ts";
import { modelsFolders, type ProjectOptions } from "../project/targets.ts";
import { fingerprintIn, fingerprintOf } from "./render.ts";
import { withModels } from "./models.ts";
import type { GeneratedTable } from "../adapter.ts";
import { schemaRefusal, schemaSourceOf, schemaWrites } from "./writes.ts";

export interface SchemaOptions extends ProjectOptions {
  /** The project's folder; the current one by default. */
  cwd?: string;
  /** Only report whether the generated files are current (for CI). */
  check?: boolean;
}

/** A schema that couldn't be generated: the errors, and that the last good file stays as it was. */
function failed(errors: readonly string[], cwd: string, db: DatabaseSnapshot): Plan {
  const out = shown(cwd, db.target.out);
  const kept = db.schema === undefined ? `Wrote nothing to ${out}` : `Kept ${out} as it was`;
  return printing([...errors, kept], 1);
}

/** `--check`: whether the file on disk was generated from these tables (its fingerprint, not its format). */
function checkPlan(cwd: string, db: DatabaseSnapshot, tables: readonly GeneratedTable[]): Plan {
  const out = shown(cwd, db.target.out);
  const schema = schemaSourceOf(db, tables);
  const current = db.schema !== undefined && fingerprintIn(db.schema) === fingerprintOf(schema);
  const line = current
    ? `${out} is up to date`
    : `${out} is out of date: run \`active-record schema\``;
  return printing([line], current ? 0 : 1);
}

/** One database's schema, generated (or, with `check`, checked). */
async function planDatabase(
  project: ProjectSnapshot,
  db: DatabaseSnapshot,
  check: boolean,
): Promise<Plan> {
  const { adapter, cwd } = project;
  if (db.migrations === undefined) {
    return failed([`No migrations folder at ${shown(cwd, db.target.migrationsDir)}/`], cwd, db);
  }
  const refusal = check ? undefined : schemaRefusal(cwd, db);
  if (refusal !== undefined) return failed([refusal], cwd, db);
  if (db.modelErrors.length > 0) return failed(db.modelErrors, cwd, db);
  const migrationsTable = db.target.database.migrationsTable;
  const result = await adapter.readSchema(db.migrations, { migrationsTable });
  if (!result.ok) return failed(result.errors, cwd, db);
  return check ? checkPlan(cwd, db, result.tables) : schemaWrites(cwd, db, result);
}

/** What `active-record schema` writes and prints for a project (or, with `check`, only prints). */
export async function planSchema(project: ProjectSnapshot, check: boolean): Promise<Plan> {
  return combined(
    await Promise.all(project.databases.map((db) => planDatabase(project, db, check))),
  );
}

/**
 * `active-record schema`: generates each D1 database's `schema.ts` from its migrations and the Models
 * built on it (#66, #68, #232). Resolves to the exit code: 0, or 1 when anything failed or, with
 * `check`, is out of date.
 */
export async function runSchema(options: SchemaOptions, print: Print): Promise<number> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const adapter = await loadAdapter(cwd, options.adapter);
  if (typeof adapter === "string") {
    print(adapter);
    return 1;
  }
  const read = readProject(adapter, cwd, options);
  if (typeof read === "string") {
    print(read);
    return 1;
  }
  const project = await withModels(read, { models: options.models, check: options.check });
  return apply(await planSchema(project, options.check === true), project.cwd, print);
}

/**
 * `active-record schema --watch`: generates, then again whenever a migration or a Model file changes,
 * keeping the last good file when one fails. Returns a function that stops watching.
 */
export async function watchSchema(options: SchemaOptions, print: Print): Promise<() => void> {
  let running = runSchema(options, print);
  const cwd = resolve(options.cwd ?? process.cwd());
  const adapter = await loadAdapter(cwd, options.adapter);
  if (typeof adapter === "string") return () => {};
  const project = readProject(adapter, cwd, options);
  if (typeof project === "string") return () => {};
  let pending: ReturnType<typeof setTimeout> | undefined;
  const regenerate = () => {
    clearTimeout(pending);
    // One run at a time, so two never load the Models at once.
    pending = setTimeout(() => {
      running = running.then(() => runSchema(options, print));
    }, 50);
  };
  const folders = [
    ...project.databases
      .filter((db) => db.migrations !== undefined)
      .map((db) => db.target.migrationsDir),
    ...modelsFolders(cwd, options.models),
  ];
  const watchers = folders.map((folder) => watch(folder, { recursive: true }, regenerate));
  return () => {
    clearTimeout(pending);
    for (const watcher of watchers) watcher.close();
  };
}
