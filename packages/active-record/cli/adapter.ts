// What an adapter's plugin gives the `active-record` command (#278): its project config, schema reader, migrations and console database.
import type { ColumnArg } from "./generate/columns.ts";
import type { Migration } from "./project/migrations.ts";

/** One database a project declares, and where its migrations are. */
export interface DatabaseConfig {
  /** Its name in the app's config, which a generated schema names: its **Binding** (`DB`). */
  binding: string;
  /** Relative to the config file. */
  migrationsDir: string;
  /** A glob for migrations in nested folders, from the config's `patternSetting`. */
  migrationsPattern?: string;
  /** The adapter's record of applied migrations, left out of the schema. */
  migrationsTable?: string;
  /** The database's entry as the config has it. */
  entry: Record<string, unknown>;
}

/**
 * The databases a project's `active-record.jsonc` names, each with its entry as the file has it
 * (its `adapter` included), and the file and its folder.
 */
export interface ProjectDatabases {
  file: string;
  dir: string;
  /** Each database's entry, by binding, in the file's order. */
  databases: Readonly<Record<string, Record<string, unknown>>>;
}

/** A project's config: the file, its folder, and its databases, or why it can't be read. */
export type ConfigResult =
  | { ok: true; file: string; dir: string; databases: DatabaseConfig[] }
  | { ok: false; error: string };

type AttributeType = "string" | "integer" | "real" | "boolean" | "datetime" | "json";

/** A default the generated spec carries: a literal value, or a date. */
export type Default = { literal: unknown } | { date: string };

/** One attribute as the generated schema declares it, the shape `Model.define({...})` takes. */
export interface Spec {
  type: AttributeType;
  null?: false;
  column?: string;
  default?: Default;
  /** A key made in code by the Model's `generateId` (#99). */
  generateId?: true;
}

/** One table, ready to generate: its attributes in column order. */
export interface GeneratedTable {
  name: string;
  /** The `const` it's exported as in the generated file. */
  exportName: string;
  primaryKey: string;
  /** The migration that created or last changed it. */
  lastChangedBy: string;
  attributes: Record<string, Spec>;
  /** Its key column's type, as the database declares it (`uuid`), when the adapter reads one. */
  keyType?: string;
}

/** A database's tables, read from its migrations, with notes for a person, or why they can't be. */
export type SchemaResult =
  | { ok: true; tables: GeneratedTable[]; notes: string[]; textDates: string[] }
  | { ok: false; errors: string[] };

/** What an adapter reads a database's schema with, besides its migrations. */
export interface SchemaOptions {
  /** The adapter's record of applied migrations, left out of the schema. */
  migrationsTable?: string;
  /** The database's entry, as the config has it, for an adapter that reads more of it. */
  entry?: Record<string, unknown>;
}

/** What `g model` and `g migration` ask an adapter for: a migration's SQL. */
export interface MigrationChange {
  /** The migration's name, as Rails reads it (`CreateProducts`, `AddSkuToProducts`, …). */
  name: string;
  columns: readonly ColumnArg[];
  /**
   * Each existing table's key column's type, as its adapter declares it (`INTEGER`, `uuid`), for
   * the columns that reference it.
   */
  keys: ReadonlyMap<string, string>;
  /** `--id integer`, and `--no-timestamps` as `timestamps: false`. */
  options: { integerId?: boolean; timestamps?: boolean };
}

/** A migration's SQL, or why it can't be written. */
export type MigrationResult =
  /** `notes` say what was guessed, such as the key type of a table the migrations don't make yet. */
  { ok: true; sql: string; notes?: string[] } | { ok: false; error: string };

/** The database a command acts on, and the config file that declares it. */
export interface ChosenDatabase {
  binding: string;
  /** Its entry, as the config has it. */
  entry: Record<string, unknown>;
  configFile: string;
  /** Its migrations folder, as an absolute path. */
  migrationsDir: string;
}

/** A remote database, named for a person to confirm before anything reaches it. */
export interface RemoteTarget {
  /** What the person types to confirm: its name. */
  name: string;
  /** "Remote database DB (shop, id 1a2b)". */
  description: string;
  /** A line more, when the remote database isn't the one a person would expect. */
  note?: string;
}

/** An open database for the console, what to tell the person about it, and how to close it. */
export interface OpenBinding {
  /** What the project's `connect` takes, as a Worker's `env` holds it. */
  binding: unknown;
  description: string;
  dispose: () => Promise<void>;
}

/** Where `migrate` writes what the adapter's own tool prints. */
export interface MigrateOutput {
  output: (text: string) => void;
}

/** An adapter's plugin for the `active-record` command, from its `/cli` entry (ADR-0016). */
export interface CliAdapter {
  /** The name a database's `adapter` takes, which a generated schema imports its factory by. */
  readonly name: string;
  /**
   * The config setting a database's `migrationsPattern` comes from, as a person writes it in the
   * config; none when the adapter reads no pattern, and migrations in folders go unread.
   */
  readonly patternSetting?: string;
  /** Why this Node can't run the plugin, if it can't; the command refuses before it starts. */
  unsupported?(): string | undefined;
  /**
   * The project's databases, from the entries its `active-record.jsonc` has for this adapter (and
   * the adapter's own config, if it reads one), or why they can't be read.
   */
  databases(project: ProjectDatabases): ConfigResult;
  /** A database's tables, from its migrations applied in order. */
  readSchema(migrations: readonly Migration[], options: SchemaOptions): Promise<SchemaResult>;
  /** A migration's SQL; the command names its file. */
  migration(change: MigrationChange): MigrationResult;
  /**
   * The remote database `chosen` names, or why it has none: the one the console opens, or the one
   * `migrate` applies migrations to, which needn't be the same (a preview database, say).
   */
  remote(chosen: ChosenDatabase, use: "open" | "migrate"): RemoteTarget | string;
  /**
   * The folder for the command's own local files, such as the console's history: one the
   * project's tools already keep out of version control.
   */
  stateFolder(chosen: ChosenDatabase): string;
  /** Opens the database for the console: the local one, or with `remote`, the real one. */
  open(
    cwd: string,
    chosen: ChosenDatabase,
    options: { remote: boolean },
  ): Promise<OpenBinding | string>;
  /** Applies the pending migrations, locally or with `remote` to the real database; the exit code. */
  migrate(
    cwd: string,
    chosen: ChosenDatabase,
    options: { remote: boolean },
    io: MigrateOutput,
  ): Promise<number>;
}

/** The project's adapter, as the command uses it: its plugin, reading the project's databases. */
export type ProjectAdapter = Omit<CliAdapter, "databases"> & {
  /** The project's databases, or why they can't be read. */
  databases(): ConfigResult;
};
