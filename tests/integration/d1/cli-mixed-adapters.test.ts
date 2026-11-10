import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { PassThrough } from "node:stream";
import { runConsole } from "../../../packages/active-record/cli/console/command.ts";
import { runGenerate } from "../../../packages/active-record/cli/generate/command.ts";
import { runMigrate } from "../../../packages/active-record/cli/migrate/command.ts";
import { runSchema } from "../../../packages/active-record/cli/schema/command.ts";
import { capturedStreams } from "../../support/console.ts";
import { writePgProject, type PgDatabases } from "../../support/pg-project.ts";
import { scratchDirs } from "../../support/scratch.ts";

// PGlite starts for each Postgres schema read, which takes seconds with coverage on.
const pgliteTimeout = { timeout: 60_000 };

const scratch = scratchDirs();

/** A Wrangler config binding these D1 databases. */
const wrangler = (...bindings: string[]) =>
  JSON.stringify({ d1_databases: bindings.map((binding) => ({ binding, database_id: "x" })) });

/**
 * A project with a D1 database, `DB`, reading `migrations/`, and a Postgres one, `HYPERDRIVE`,
 * reading `pg-migrations/`, plus these files; or with `databases` in their place.
 */
function mixedProject(files: Record<string, string> = {}, databases?: PgDatabases): string {
  return writePgProject(
    scratch("mixed-"),
    databases ?? { DB: { adapter: "d1" }, HYPERDRIVE: { migrationsDir: "pg-migrations" } },
    {
      "wrangler.jsonc": wrangler("DB"),
      "migrations/0001_posts.sql": "CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT);",
      "pg-migrations/1_users.sql": "CREATE TABLE users (id UUID PRIMARY KEY, admin BOOLEAN);",
      ...files,
    },
  );
}

/** Runs a command in the project, collecting what it prints. */
async function run(
  command: (options: { cwd: string }, print: (line: string) => void) => Promise<number>,
  cwd: string,
) {
  const lines: string[] = [];
  const code = await command({ cwd }, (line) => lines.push(line));
  return { code, output: lines.join("\n") };
}

/** A Model on each database's base class. */
const posts = 'import { DbRecord } from "./db-record";\nexport class Post extends DbRecord {}\n';
const users =
  'import { HyperdriveRecord } from "./hyperdrive-record";\nexport class User extends HyperdriveRecord {}\n';

const read = (cwd: string, path: string) => readFileSync(join(cwd, path), "utf8");

/** The SQL of the migration in `folder` whose name ends with `suffix`. */
function migration(cwd: string, folder: string, suffix: string): string {
  const name = readdirSync(join(cwd, folder)).find((each) => each.endsWith(suffix));
  return name === undefined ? `no ${suffix} in ${folder}` : read(cwd, join(folder, name));
}

/** A project whose schemas were generated with a Model on each database's base class. */
async function withModels(): Promise<string> {
  const cwd = mixedProject();
  await run(runSchema, cwd);
  writeFileSync(join(cwd, "src/models/post.ts"), posts);
  writeFileSync(join(cwd, "src/models/user.ts"), users);
  await run(runSchema, cwd);
  return cwd;
}

/** `schema --check`. */
const checking = (options: { cwd: string }, print: (line: string) => void) =>
  runSchema({ ...options, check: true }, print);

/** `migrate` on the database `--database` names, if any: its code, its lines, and Wrangler's output. */
async function migrating(cwd: string, database?: string) {
  const output = new PassThrough();
  let applied = "";
  output.on("data", (chunk: Buffer) => (applied += chunk.toString()));
  const said: string[] = [];
  const io = { input: new PassThrough(), output, terminal: false };
  const code = await runMigrate({ cwd, database }, (line) => said.push(line), io);
  return { code, said, applied };
}

/** What a command says when it needs `--database`. */
const asked = "This config has several databases; choose one with --database (DB or HYPERDRIVE)";

/** `g model <name> name:string` in the project, on the database `--database` names, if any. */
const generate =
  (name: string, database?: string) => (options: { cwd: string }, print: (line: string) => void) =>
    runGenerate({ ...options, kind: "model", name, columns: ["name:string"], database }, print);

// One project, databases on different adapters: each read by its own adapter's plugin (#305).
describe("a project whose databases use different adapters", pgliteTimeout, () => {
  test("schema writes each database's schema through its own adapter", async () => {
    const cwd = mixedProject();

    const { code, output } = await run(runSchema, cwd);

    expect([code, output]).toEqual([
      0,
      [
        "Wrote src/db/DB.ts (1 table) from migrations/",
        "Wrote src/models/db-record.ts",
        "Wrote src/db/HYPERDRIVE.ts (1 table) from pg-migrations/",
        "Wrote src/models/hyperdrive-record.ts",
      ].join("\n"),
    ]);
    const d1 = read(cwd, "src/db/DB.ts");
    expect(d1).toContain('import { d1 } from "@forestfuture/active-record/d1";');
    expect(d1).toContain('adapter: d1({ binding: "DB" }),');
    expect(d1).toContain("posts");
    const pg = read(cwd, "src/db/HYPERDRIVE.ts");
    expect(pg).toContain('import { postgresql } from "@forestfuture/active-record/postgresql";');
    expect(pg).toContain('adapter: postgresql({ binding: "HYPERDRIVE" }),');
    expect(pg).toContain("users");
  });

  test("one database's schema that fails leaves the other's written", async () => {
    const cwd = mixedProject({
      "pg-migrations/1_users.sql": "CREATE TABLE users (id UUID PRIMARY KEY",
    });

    const { code, output } = await run(runSchema, cwd);

    expect(code).toBe(1);
    expect(output).toContain("Wrote src/db/DB.ts (1 table) from migrations/");
    expect(output).toContain("Wrote nothing to src/db/HYPERDRIVE.ts");
  });

  test("schema lists each database's Models in its own schema", async () => {
    const cwd = await withModels();

    expect(read(cwd, "src/db/DB.ts")).toContain('  models: { Post: "posts" },');
    expect(read(cwd, "src/db/HYPERDRIVE.ts")).toContain('  models: { User: "users" },');
  });

  test("schema --check finds each database's schema up to date", async () => {
    const cwd = await withModels();

    expect(await run(checking, cwd)).toEqual({
      code: 0,
      output: "src/db/DB.ts is up to date\nsrc/db/HYPERDRIVE.ts is up to date",
    });
  });

  test("g --database HYPERDRIVE writes a migration in Postgres's types", async () => {
    const cwd = mixedProject();

    expect((await run(generate("Product", "HYPERDRIVE"), cwd)).code).toBe(0);

    expect(migration(cwd, "pg-migrations", "_create_products.sql")).toMatch(/id UUID PRIMARY KEY/);
    expect(read(cwd, "src/db/HYPERDRIVE.ts")).toContain("products");
  });

  test("g --database DB writes a migration in SQLite's types", async () => {
    const cwd = mixedProject();

    expect((await run(generate("Tag", "DB"), cwd)).code).toBe(0);

    expect(migration(cwd, "migrations", "_create_tags.sql")).toMatch(/id TEXT PRIMARY KEY/);
    expect(read(cwd, "src/db/DB.ts")).toContain("tags");
  });

  test("g without --database asks for one, as with several databases on one adapter", async () => {
    const cwd = mixedProject();

    expect(await run(generate("Product"), cwd)).toEqual({ code: 1, output: asked });
  });

  // Their D1 side, which needs no Postgres server: tests/integration/pg/ has the other.
  test("migrate --database DB applies D1's migrations through Wrangler", async () => {
    const cwd = mixedProject();

    const migrated = await migrating(cwd, "DB");

    expect(migrated).toEqual({
      code: 0,
      said: [],
      applied: expect.stringContaining("0001_posts.sql"),
    });
  }, 120_000);

  test("console --database DB opens the local D1 database, with every Model", async () => {
    const cwd = await withModels();
    await migrating(cwd, "DB");
    const streams = capturedStreams();

    const opened = await runConsole(
      { cwd, database: "DB", eval: "await Post.count()" },
      () => {},
      streams,
    );

    expect([opened, streams.seen.stdout]).toEqual([0, "0\n"]);
    expect(streams.seen.stderr).toBe("Local database DB (.wrangler/state)\nModels: Post, User\n");
  }, 120_000);

  test("migrate without --database asks for one", async () => {
    const cwd = mixedProject();

    expect(await migrating(cwd)).toEqual({ code: 1, said: [asked], applied: "" });
  });

  test("console without --database asks for one", async () => {
    const cwd = mixedProject();
    const said: string[] = [];

    expect(await runConsole({ cwd }, (line) => said.push(line), capturedStreams())).toBe(1);
    expect(said).toEqual([asked]);
  });
});
