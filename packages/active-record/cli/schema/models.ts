// Finds each database's Models for its generated schema: the Model files loaded with jiti, with
// the schema as the migrations make it now standing in for each schema file (#232).
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { dirname, resolve, sep } from "node:path";
import { ancestors } from "../../src/ancestors.ts";
import { isBase } from "../../src/generated-model.ts";
import {
  forgetProjectFiles,
  corePackage,
  loadLibrary,
  modelFiles,
  projectJiti,
  type Jiti,
} from "../project/load.ts";
import { isIdentifier } from "../project/names.ts";
import { shown } from "../project/paths.ts";
import type { DatabaseSnapshot, FoundModel, ProjectSnapshot } from "../project/snapshot.ts";
import { defaultModels } from "../project/targets.ts";
import { renderSchema } from "./render.ts";
import { schemaAdapterOf } from "./writes.ts";

/** What finding Models uses of the project's own library: its base class. */
interface Library {
  Model: abstract new (...args: never[]) => unknown;
}

/** A class as loaded, with the statics finding its Models reads. */
interface LoadedClass {
  name: string;
  modelName: string;
  table: string;
  attributeDefinitions: unknown;
}

/** The Models found so far, by class, and why any couldn't be. */
interface Found {
  models: Map<object, FoundModel>;
  /** The database each Model found is on. */
  databases: Map<object, DatabaseSnapshot>;
  errors: string[];
}

/**
 * Writes a schema file that's missing, for while the Models load: an import finds a module only
 * when its file exists. The plan writes the real one. Returns its path, to remove afterwards.
 */
function placeholder(out: string, source: string): string {
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, source);
  return out;
}

/**
 * Evaluates each database's schema as its migrations make it now, in place of its file, so the
 * Models load with every table and with no list of Models to be checked against. Returns each
 * schema value, with its database.
 */
async function freshSchemas(
  jiti: Jiti,
  project: ProjectSnapshot,
  placeholders: string[],
): Promise<Map<unknown, DatabaseSnapshot>> {
  const schemas = new Map<unknown, DatabaseSnapshot>();
  for (const db of project.databases) {
    const { database, out } = db.target;
    const { migrationsTable, entry } = database;
    const result = await db.target.adapter.readSchema(db.migrations ?? [], {
      migrationsTable,
      entry,
    });
    if (db.migrations === undefined || !result.ok) continue;
    const source = renderSchema(
      {
        adapter: schemaAdapterOf(db.target.adapter),
        tables: result.tables,
        binding: database.binding,
        models: [],
      },
      "",
    );
    if (!existsSync(out)) placeholders.push(placeholder(out, source));
    const exported = (await jiti.evalModule(source, { filename: out, async: true })) as {
      schema: { models?: unknown };
    };
    delete exported.schema.models;
    schemas.set(exported.schema, db);
  }
  return schemas;
}

/** The database whose schema a class's nearest base holds, if it's one being generated. */
function databaseOf(
  value: object,
  schemas: ReadonlyMap<unknown, DatabaseSnapshot>,
): DatabaseSnapshot | undefined {
  const holder = ancestors(value).find((each) => Object.hasOwn(each, "schema"));
  return holder === undefined ? undefined : schemas.get((holder as { schema: unknown }).schema);
}

/** Whether `file` declares the class itself, rather than exporting it from another file. */
function isDeclaredIn(file: string, name: string): boolean {
  return new RegExp(`\\bclass\\s+${name}\\b`).test(readFileSync(file, "utf8"));
}

/** A class a file exports, by the name it's exported as, and the database it's on. */
interface Exported {
  name: string;
  model: LoadedClass;
  database: DatabaseSnapshot;
}

/**
 * What's wrong with a Model's `modelName`, which the schema lists it by, if anything: one that
 * isn't a string, or one another Model found already has.
 */
function modelNameProblem(
  cwd: string,
  found: Found,
  { model, database }: Exported,
): string | undefined {
  if (typeof model.modelName !== "string") {
    return `${model.name}'s modelName must be a string; remove it to use the class name`;
  }
  for (const [other, each] of found.models) {
    const sameDatabase = found.databases.get(other) === database;
    if (other !== model && sameDatabase && each.modelName === model.modelName) {
      return (
        `${model.name} and ${each.className} (${shown(cwd, each.file)}) both have the modelName ` +
        `${model.modelName}; give each Model its own`
      );
    }
  }
  return undefined;
}

/** Adds a class from `file` if it's a Model directly below a base: one whose table it is. */
function addModel(cwd: string, file: string, exported: Exported, found: Found): void {
  const { name, model } = exported;
  if (isBase(model) || !isBase(Object.getPrototypeOf(model) as object)) return;
  if (name === "default") {
    found.errors.push(
      `${shown(cwd, file)} exports ${model.name} as its default; export it by name ` +
        `(export class ${model.name} …), so active-record schema can add its attributes`,
    );
    return;
  }
  // Its name is written into schema.ts as code.
  if (!isIdentifier(model.name)) {
    found.errors.push(
      `${shown(cwd, file)} exports a Model named ${JSON.stringify(model.name)}, which isn't a name ` +
        "active-record schema can write as code; name the class with letters, digits, _ and $",
    );
    return;
  }
  const earlier = found.models.get(model);
  if (earlier !== undefined && !isDeclaredIn(file, model.name)) return;
  const problem = modelNameProblem(cwd, found, exported);
  if (problem !== undefined) {
    found.errors.push(`${shown(cwd, file)}: ${problem}`);
    return;
  }
  try {
    void model.attributeDefinitions;
  } catch (error) {
    found.errors.push(`${shown(cwd, file)}: ${(error as Error).message}`);
    return;
  }
  found.models.set(model, {
    className: model.name,
    modelName: model.modelName,
    table: model.table,
    file,
  });
  found.databases.set(model, exported.database);
}

/** Imports a Model file, or says why it couldn't be loaded. */
async function importFile(
  cwd: string,
  jiti: Jiti,
  file: string,
): Promise<Record<string, unknown> | string> {
  try {
    return await jiti.import<Record<string, unknown>>(file);
  } catch (error) {
    // Syntax errors name the file by its full path; the project's own folder is implied.
    const message = (error as Error).message.replaceAll(`${resolve(cwd)}${sep}`, "");
    return `Couldn't load ${shown(cwd, file)}: ${message}`;
  }
}

/** Adds the Models a file exports that are built on a schema being generated. */
function addExported(
  cwd: string,
  file: string,
  exported: Record<string, unknown>,
  context: { library: Library; schemas: ReadonlyMap<unknown, DatabaseSnapshot>; found: Found },
): void {
  for (const [name, value] of Object.entries(exported)) {
    const isModel = typeof value === "function" && value.prototype instanceof context.library.Model;
    const database = isModel ? databaseOf(value, context.schemas) : undefined;
    if (database !== undefined) {
      const model = value as unknown as LoadedClass;
      addModel(cwd, file, { name, model, database }, context.found);
    }
  }
}

/** Loads the Model files, finding the Models built on the schemas being generated. */
async function modelsIn(
  cwd: string,
  jiti: Jiti,
  files: readonly string[],
  schemas: ReadonlyMap<unknown, DatabaseSnapshot>,
): Promise<{ found: Found; library: Library | string }> {
  const found: Found = { models: new Map(), databases: new Map(), errors: [] };
  // Finding Models takes only the core's Model, whichever adapter they're on.
  const library = await loadLibrary<Library>(cwd, jiti, {
    command: "schema",
    packages: [corePackage],
  });
  if (typeof library === "string") return { found, library };
  for (const file of files) {
    const exported = await importFile(cwd, jiti, file);
    if (typeof exported === "string") found.errors.push(exported);
    else addExported(cwd, file, exported, { library, schemas, found });
  }
  return { found, library };
}

/**
 * The project with each database's Models, found by loading its Model files as its own code
 * would; or with why they couldn't be, on every database. With no Model files, there are none.
 */
export async function withModels(
  project: ProjectSnapshot,
  { models = defaultModels, check = false }: { models?: string; check?: boolean } = {},
): Promise<ProjectSnapshot> {
  const { cwd } = project;
  const files = modelFiles(cwd, models);
  if (typeof files === "string" || files.length === 0) return project;
  // A missing schema file is out of date anyway, and --check writes nothing, not even for a
  // moment to load the Models with.
  if (check && project.databases.some((db) => db.schema === undefined)) return project;
  const jiti = projectJiti(cwd);
  const loadedBefore = new Set(Object.keys(jiti.cache));
  const placeholders: string[] = [];
  try {
    const schemas = await freshSchemas(jiti, project, placeholders);
    const { found, library } = await modelsIn(cwd, jiti, files, schemas);
    const errors = typeof library === "string" ? [library] : found.errors;
    const databases = project.databases.map((db) => ({
      ...db,
      models: [...found.models.entries()]
        .filter(([model]) => databaseOf(model, schemas) === db)
        .map(([, model]) => model),
      modelErrors: errors,
    }));
    return { ...project, databases };
  } finally {
    for (const path of placeholders) rmSync(path);
    // Loaded again on the next run (`--watch`), as edited.
    forgetProjectFiles(cwd, jiti, loadedBefore);
  }
}
