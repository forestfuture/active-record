import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
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
    scratch("mixed-", true),
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
});
