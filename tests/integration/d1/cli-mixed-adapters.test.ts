import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { runGenerate } from "../../../packages/active-record/cli/generate/command.ts";
import { runSchema } from "../../../packages/active-record/cli/schema/command.ts";
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

const read = (cwd: string, path: string) => readFileSync(join(cwd, path), "utf8");

/** The SQL of the migration in `folder` whose name ends with `suffix`. */
function migration(cwd: string, folder: string, suffix: string): string {
  const name = readdirSync(join(cwd, folder)).find((each) => each.endsWith(suffix));
  return name === undefined ? `no ${suffix} in ${folder}` : read(cwd, join(folder, name));
}

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

  test("schema finds each database's Models on its base class, and --check passes", async () => {
    const cwd = mixedProject();
    await run(runSchema, cwd);
    writeFileSync(
      join(cwd, "src/models/post.ts"),
      'import { DbRecord } from "./db-record";\nexport class Post extends DbRecord {}\n',
    );
    writeFileSync(
      join(cwd, "src/models/user.ts"),
      'import { HyperdriveRecord } from "./hyperdrive-record";\nexport class User extends HyperdriveRecord {}\n',
    );

    expect((await run(runSchema, cwd)).code).toBe(0);

    expect(read(cwd, "src/db/DB.ts")).toContain('  models: { Post: "posts" },');
    expect(read(cwd, "src/db/HYPERDRIVE.ts")).toContain('  models: { User: "users" },');
    expect(
      await run((options, print) => runSchema({ ...options, check: true }, print), cwd),
    ).toEqual({
      code: 0,
      output: "src/db/DB.ts is up to date\nsrc/db/HYPERDRIVE.ts is up to date",
    });
  });

  test("g writes a migration in the types of the database --database names", async () => {
    const cwd = mixedProject();

    expect((await run(generate("Product", "HYPERDRIVE"), cwd)).code).toBe(0);
    expect((await run(generate("Tag", "DB"), cwd)).code).toBe(0);

    expect(migration(cwd, "pg-migrations", "_create_products.sql")).toMatch(/id UUID PRIMARY KEY/);
    expect(migration(cwd, "migrations", "_create_tags.sql")).toMatch(/id TEXT PRIMARY KEY/);
    expect(read(cwd, "src/db/HYPERDRIVE.ts")).toContain("products");
    expect(read(cwd, "src/db/DB.ts")).toContain("tags");
  });

  test("g without --database asks for one, as with several databases on one adapter", async () => {
    const cwd = mixedProject();

    expect(await run(generate("Product"), cwd)).toEqual({
      code: 1,
      output: "This config has several databases; choose one with --database (DB or HYPERDRIVE)",
    });
  });
});
