// `d1-record g model` and `g migration`: plans and writes a migration, a Model, and the schema.
import { dirname, join, relative, resolve } from "node:path";
import {
  apply,
  printed,
  printing,
  written,
  type FileToWrite,
  type Plan,
  type Print,
} from "../plan.ts";
import { importPath, shown, slashed } from "../project/paths.ts";
import { classify } from "../project/names.ts";
import {
  readProject,
  type DatabaseSnapshot,
  type FoundModel,
  type ProjectSnapshot,
} from "../project/snapshot.ts";
import { defaultModels, oneModelsFile } from "../project/targets.ts";
import { chooseDatabase } from "../project/wrangler.ts";
import { byName, type Migration } from "../project/migrations.ts";
import { withModels } from "../schema/models.ts";
import { schemaOf, type GeneratedTable } from "../schema/schema.ts";
import { schemaRefusal, schemaWrites, type SchemaTables } from "../schema/writes.ts";
import { parseColumns, type ColumnArg } from "./columns.ts";
import { migrationFileName, migrationFor, type KeyType } from "./migration.ts";
import { appendModel, modelFileName, modelSource, type ModelToWrite } from "./model-file.ts";
import { migrationNameError, modelName, tableize } from "./names.ts";

export interface GenerateOptions {
  /** The project's folder; the current one by default. */
  cwd?: string;
  /** The Wrangler config file, in place of finding it. */
  config?: string;
  /** The D1 binding to generate for, when the config has several. */
  database?: string;
  kind: "model" | "migration";
  /** The Model's class name, or the migration's name. */
  name: string;
  columns: readonly string[];
  /** `--id integer`: a key D1 generates, in place of a `TEXT` key made in code. */
  integerId?: boolean;
  /** `--no-timestamps` sets this false. */
  timestamps?: boolean;
  /** Where Model files go (`src/models`), or one file they're all appended to (`src/models.ts`). */
  models?: string;
  /** The schema file to regenerate (or, with several databases, the folder), as for `schema`. */
  out?: string;
}

/** What's being generated, once the database and the columns are known. */
interface Request {
  project: ProjectSnapshot;
  db: DatabaseSnapshot;
  options: GenerateOptions;
  columns: readonly ColumnArg[];
  /** The Model's class, for `g model`. */
  className?: string;
}

/** Everything a generator writes, once it's all been checked. */
interface Checked {
  /** The database, with the new migration among its migrations. */
  db: DatabaseSnapshot;
  migration: FileToWrite;
  model?: FileToWrite;
  schema: SchemaTables;
  notes: string[];
}

/** A refusal: these errors, then "Wrote nothing". */
function refused(...errors: string[]): Plan {
  return printing([...errors, "Wrote nothing"], 1);
}

/**
 * A refusal for a problem with the project itself (its config, or a database to choose), where
 * "Wrote nothing" would say nothing useful.
 */
function unusable(error: string): Plan {
  return printing([error], 1);
}

/** Whether a step's result is a refusal, rather than what it checked. */
function isPlan(value: object): value is Plan {
  return "steps" in value;
}

/** The database to generate for: the only one, or the one `--database` names. */
function databaseFor(
  project: ProjectSnapshot,
  options: GenerateOptions,
): DatabaseSnapshot | string {
  const chosen = chooseDatabase(
    project.databases.map((db) => db.target.database),
    options.database,
  );
  if (typeof chosen === "string") return chosen;
  // Safe: `chosen` is one of these snapshots' own `target.database` objects, returned as it was.
  return project.databases.find((db) => db.target.database === chosen)!;
}

/** Wrangler only applies migrations its `migrations_pattern` matches, so refuse any other file. */
function patternRefusal({ project, db }: Request, path: string): string | undefined {
  const { target } = db;
  const pattern = target.database.migrationsPattern;
  const relativePath = slashed(relative(target.configDir, path));
  if (
    pattern === undefined ||
    process.getBuiltinModule("node:path").matchesGlob(relativePath, pattern)
  ) {
    return undefined;
  }
  return (
    `${shown(project.cwd, path)} wouldn't match migrations_pattern (${pattern}), so Wrangler wouldn't ` +
    "apply it; write the migration with your migration tool instead"
  );
}

/** Each table's key type, for the columns that reference it. */
function keyTypes(tables: readonly GeneratedTable[]): Map<string, KeyType> {
  return new Map(
    tables.map((table) => {
      const spec = table.attributes[table.primaryKey]!;
      return [table.name, spec.type === "integer" ? "INTEGER" : "TEXT"];
    }),
  );
}

/** Where `g model` writes a Model: its own file, or the one file Models are appended to. */
function modelPathOf(cwd: string, options: GenerateOptions, className: string): string {
  const models = options.models ?? defaultModels;
  return resolve(cwd, models, oneModelsFile(models) ? "" : modelFileName(className));
}

/** The Model `g model` writes, and where (its own file, or appended to one); or why it can't. */
function modelFile(request: Request): FileToWrite | Plan {
  const { project, db, options, columns } = request;
  const { cwd } = project;
  const { target } = db;
  const className = request.className!;
  const separateFiles = !oneModelsFile(options.models ?? defaultModels);
  const path = modelPathOf(cwd, options, className);
  const model: ModelToWrite = {
    className,
    table: tableize(className),
    associations: columns
      .filter((column) => column.type === "references")
      .map((column) => ({ name: column.association!, className: classify(column.association!) })),
    base: {
      className: target.base.className,
      importPath: importPath(dirname(path), target.base.path),
    },
  };
  const existing = project.files.get(path);
  if (existing === undefined) return { path, source: modelSource(model, { separateFiles }) };
  if (separateFiles) return refused(`${shown(cwd, path)} already exists`);
  if (new RegExp(`^export class ${className}\\b`, "m").test(existing)) {
    return refused(`${shown(cwd, path)} already has ${className}`);
  }
  const appended = appendModel(existing, model);
  return appended.ok
    ? { path, source: appended.source }
    : refused(`${shown(cwd, path)}: ${appended.error}`);
}

/** Notes for references to tables the migrations don't make yet: their key type is a guess. */
function referenceNotes(
  columns: readonly ColumnArg[],
  keys: ReadonlyMap<string, KeyType>,
): string[] {
  return columns
    .filter((column) => column.type === "references" && !keys.has(column.references!))
    .map((column) => `${column.references} isn't in the migrations yet, so ${column.name} is TEXT`);
}

/** The migration, checked by applying it after the others in memory; or why it was refused. */
function checkedMigration(
  request: Request,
  existing: readonly Migration[],
): { migration: FileToWrite; after: Migration[]; schema: SchemaTables; notes: string[] } | Plan {
  const { db, options, columns } = request;
  const { target } = db;
  const migrationsTable = target.database.migrationsTable;
  const current = schemaOf(existing, { migrationsTable });
  if (!current.ok) return refused(...current.errors);
  const keys = keyTypes(current.tables);
  const stem =
    request.className === undefined ? options.name : `create_${tableize(request.className)}`;
  const name = migrationFileName(
    existing.map((each) => each.name),
    stem,
  );
  const result = migrationFor(stem, columns, keys, options);
  if (!result.ok) return refused(result.error);
  // In the order Wrangler applies them, which a migration with no number may change.
  const after = [...existing, { name, sql: result.sql }].sort((a, b) => byName(a.name, b.name));
  const checked = schemaOf(after, { migrationsTable });
  if (!checked.ok) return refused(...checked.errors);
  const migration = { path: join(target.migrationsDir, name), source: result.sql };
  return { migration, after, schema: checked, notes: referenceNotes(columns, keys) };
}

/** The request: the database, the columns and the names, each checked. */
function requestFor(
  project: ProjectSnapshot,
  options: GenerateOptions,
): (Request & { notes: string[] }) | Plan {
  const db = databaseFor(project, options);
  if (typeof db === "string") return unusable(db);
  // Checked first, so a generator never plans a migration whose schema it then can't write.
  const refusal = schemaRefusal(project.cwd, db);
  if (refusal !== undefined) return refused(refusal);
  if (db.modelErrors.length > 0) return refused(...db.modelErrors);
  const parsed = parseColumns(options.columns);
  if (!parsed.ok) return refused(...parsed.errors);
  const request = { project, db, options, columns: parsed.columns, notes: [] as string[] };
  if (options.kind === "migration") {
    const error = migrationNameError(options.name);
    return error === undefined ? request : refused(error);
  }
  const model = modelName(options.name);
  if (!model.ok) return refused(model.error);
  if (model.note !== undefined) request.notes.push(model.note);
  return { ...request, className: model.className };
}

/** The Models found, with the one `g model` writes in place of any of its name. */
function withModel(models: readonly FoundModel[], added: FoundModel): FoundModel[] {
  return [...models.filter((each) => each.className !== added.className), added];
}

/** Checks everything a generator would write, before anything is written. */
function checkedFor(project: ProjectSnapshot, options: GenerateOptions): Checked | Plan {
  const request = requestFor(project, options);
  if (isPlan(request)) return request;
  const model = request.className === undefined ? undefined : modelFile(request);
  if (model !== undefined && isPlan(model)) return model;
  const checked = checkedMigration(request, request.db.migrations ?? []);
  if (isPlan(checked)) return checked;
  const refusal = patternRefusal(request, checked.migration.path);
  if (refusal !== undefined) return unusable(refusal);
  const { migration, schema } = checked;
  // The schema is planned from the migrations and Models as they'll be, the new ones included.
  const models =
    model === undefined || request.className === undefined
      ? request.db.models
      : withModel(request.db.models, {
          className: request.className,
          table: tableize(request.className),
          file: model.path,
        });
  const db = { ...request.db, migrations: checked.after, models };
  return { db, migration, model, schema, notes: [...request.notes, ...checked.notes] };
}

/**
 * What `g model` or `g migration` writes and prints for a project: a migration (and a Model),
 * checked against the existing migrations, then the schema regenerated with it.
 */
export function planGenerate(project: ProjectSnapshot, options: GenerateOptions): Plan {
  const checked = checkedFor(project, options);
  if (isPlan(checked)) return checked;
  const { db, migration, model, notes } = checked;
  const { cwd } = project;
  const own = model === undefined ? [migration] : [migration, model];
  const schema = schemaWrites(cwd, db, checked.schema);
  const database = db.target.database.databaseName ?? db.target.database.binding;
  return {
    steps: [
      ...own.map((file) => written(file, `Wrote ${shown(cwd, file.path)}`)),
      ...schema.steps,
      ...notes.map((note) => printed(`Note: ${note}`)),
      printed(`Next: npx wrangler d1 migrations apply ${database} --local`),
    ],
    code: 0,
  };
}

/**
 * `d1-record g model` and `g migration` (#66, #70): write a migration (and a Model), checked
 * against the existing migrations first, then regenerate the schema with the project's Models.
 * Resolves to the exit code.
 */
export async function runGenerate(options: GenerateOptions, print: Print): Promise<number> {
  const cwd = resolve(options.cwd ?? process.cwd());
  const { config, models, out } = options;
  const model = options.kind === "model" ? modelName(options.name) : undefined;
  const files = model?.ok === true ? [modelPathOf(cwd, options, model.className)] : [];
  const read = readProject(cwd, { config, models, out }, files);
  if (typeof read === "string") {
    print(read);
    return 1;
  }
  const project = await withModels(read, { models });
  return apply(planGenerate(project, options), cwd, print);
}
