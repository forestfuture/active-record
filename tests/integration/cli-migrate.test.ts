import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, test } from "vite-plus/test";
import { runMigrate } from "../../packages/active-record/cli/migrate/command.ts";
import { cli } from "../../packages/d1-record/cli/plugin.ts";
import { scratchDirs } from "../support/scratch.ts";

const scratch = scratchDirs();

/** A Worker project in the repo (it finds this repo's wrangler), with one migration. */
function project(entry: Record<string, unknown> = {}): string {
  const cwd = scratch("migrate-");
  const database = { binding: "DB", database_name: "shop", database_id: "local-shop", ...entry };
  writeFileSync(join(cwd, "wrangler.jsonc"), JSON.stringify({ d1_databases: [database] }));
  mkdirSync(join(cwd, "migrations"));
  writeFileSync(
    join(cwd, "migrations/0001_create_users.sql"),
    "CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL);\n",
  );
  return cwd;
}

/** Runs `migrate` with these options, as from a pipe unless `terminal`; its code and its output. */
async function migrated(cwd: string, options: object = {}, typed?: string) {
  const input = new PassThrough();
  const output = new PassThrough();
  let printed = "";
  output.on("data", (chunk: Buffer) => (printed += chunk.toString()));
  const lines: string[] = [];
  const io = { input, output, terminal: typed !== undefined };
  const running = runMigrate({ cwd, ...options }, (line) => lines.push(line), io);
  if (typed !== undefined) input.write(`${typed}\n`);
  const code = await running;
  return { code, printed, lines };
}

// `active-record migrate` applies pending migrations through the adapter (#278).
describe("migrate", () => {
  test("applies the pending migrations to the local database, through the project's Wrangler", async () => {
    const cwd = project();

    const { code, printed } = await migrated(cwd);

    expect([code, printed]).toEqual([0, expect.stringContaining("0001_create_users.sql")]);
    const opened = await cli.open(
      cwd,
      {
        binding: "DB",
        entry: { binding: "DB", database_name: "shop", database_id: "local-shop" },
        configFile: join(cwd, "wrangler.jsonc"),
        migrationsDir: join(cwd, "migrations"),
      },
      { remote: false },
    );
    if (typeof opened === "string") throw new Error(opened);
    try {
      const binding = opened.binding as {
        prepare(sql: string): { all(): Promise<{ results: unknown[] }> };
      };
      const { results } = await binding
        .prepare("SELECT name FROM sqlite_master WHERE name = 'users'")
        .all();
      expect(results).toEqual([{ name: "users" }]);
    } finally {
      await opened.dispose();
    }
  }, 120_000);

  test("has nothing to do the second time", async () => {
    const cwd = project();
    await migrated(cwd);

    const { code, printed } = await migrated(cwd);

    expect(code).toBe(0);
    expect(printed).not.toContain("0001_create_users.sql │");
  }, 120_000);

  test("--remote asks for the database's name first, and does nothing when it isn't typed", async () => {
    const { code, printed, lines } = await migrated(project(), { remote: true }, "nope");

    expect(printed).toContain("Remote database DB (shop, id local-shop)");
    expect(printed).toContain("Its pending migrations are applied to it");
    expect([code, lines]).toEqual([1, ["Not migrated."]]);
  });

  test("--remote confirms the database Wrangler migrates, database_id, not a preview database", async () => {
    const cwd = project({ preview_database_id: "preview-shop" });

    const { printed } = await migrated(cwd, { remote: true }, "nope");

    expect(printed).toContain("Remote database DB (shop, id local-shop)");
    expect(printed).not.toContain("preview");
  });

  test("--remote refuses without a terminal, unless --yes", async () => {
    const { code, lines } = await migrated(project(), { remote: true });

    expect([code, lines]).toEqual([
      1,
      ["Migrating a remote database asks you to confirm it: run this on a terminal, or add --yes"],
    ]);
  });

  test("--remote refuses a database with no id, before asking", async () => {
    const { code, lines } = await migrated(project({ database_id: undefined }), { remote: true });

    expect([code, lines]).toEqual([
      1,
      ["DB has no database_id in wrangler.jsonc, which --remote needs"],
    ]);
  });
});
