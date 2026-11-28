import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { describe, expect, test } from "vite-plus/test";
import { runMigrate } from "../../../packages/arbor/cli/migrate/command.ts";
import { cli } from "../../../packages/arbor/cli/adapters/d1/plugin.ts";
import { d1Config } from "../../support/d1-config.ts";
import { scratchDirs } from "../../support/scratch.ts";

const scratch = scratchDirs();

/** A Worker project in the repo (it finds this repo's wrangler), with one migration. */
function project(entry: Record<string, unknown> = {}): string {
  const cwd = scratch("migrate-");
  const database = { binding: "DB", database_name: "shop", database_id: "local-shop", ...entry };
  writeFileSync(join(cwd, "wrangler.jsonc"), JSON.stringify({ d1_databases: [database] }));
  writeFileSync(join(cwd, "arbor.jsonc"), d1Config("DB"));
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

// `arbor migrate` applies pending migrations through the adapter (#278).
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

  test("first notes a D1 database arbor.jsonc doesn't name", async () => {
    const cwd = project();
    const db = { binding: "DB", database_name: "shop", database_id: "local-shop" };
    const databases = [db, { binding: "LOGS" }];
    writeFileSync(join(cwd, "wrangler.jsonc"), JSON.stringify({ d1_databases: databases }));

    // --remote from a pipe refuses before Wrangler starts, after the notes.
    const { code, lines } = await migrated(cwd, { remote: true });

    expect([code, lines]).toEqual([
      1,
      [
        "Note: wrangler.jsonc has the D1 database LOGS, which arbor.jsonc doesn't name; run `npx arbor init` to add it",
        "Migrating a remote database asks you to confirm it: run this on a terminal, or add --yes",
      ],
    ]);
  });

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

/** The two D1 databases of `twoDatabases`, as its Wrangler config declares them. */
const shopDb = { binding: "DB", database_name: "shop", database_id: "local-shop" };
const logsDb = { binding: "LOGS", database_name: "logs", database_id: "local-logs" };

/** A project with two D1 databases: DB, reading `migrations/`, then LOGS, reading `logs/`. */
function twoDatabases(logs: Record<string, unknown> = {}): string {
  const cwd = project();
  const databases = [shopDb, { ...logsDb, migrations_dir: "logs" }];
  writeFileSync(join(cwd, "wrangler.jsonc"), JSON.stringify({ d1_databases: databases }));
  const entries = { DB: { adapter: "d1" }, LOGS: { adapter: "d1", ...logs } };
  writeFileSync(join(cwd, "arbor.jsonc"), JSON.stringify({ databases: entries }));
  mkdirSync(join(cwd, "logs"));
  writeFileSync(
    join(cwd, "logs/0001_create_entries.sql"),
    "CREATE TABLE entries (id INTEGER PRIMARY KEY, message TEXT);\n",
  );
  return cwd;
}

/** The tables `twoDatabases` migrations make that the local database `entry` has. */
async function tablesIn(cwd: string, entry: { binding: string }, folder: string) {
  const configFile = join(cwd, "wrangler.jsonc");
  const chosen = { binding: entry.binding, entry, configFile, migrationsDir: join(cwd, folder) };
  const opened = await cli.open(cwd, chosen, { remote: false });
  if (typeof opened === "string") throw new Error(opened);
  try {
    const db = opened.binding as {
      prepare(sql: string): { all(): Promise<{ results: { name: string }[] }> };
    };
    const { results } = await db
      .prepare("SELECT name FROM sqlite_master WHERE name IN ('users', 'entries')")
      .all();
    return results.map((row) => row.name);
  } finally {
    await opened.dispose();
  }
}

// With several databases, `migrate` migrates each one, in arbor.jsonc's order (#313).
describe("migrate, with several databases", () => {
  test("applies each database's pending migrations, in the config's order", async () => {
    const cwd = twoDatabases();

    const { code, printed } = await migrated(cwd);

    expect(code).toBe(0);
    expect(printed.indexOf("0001_create_users.sql")).toBeGreaterThan(-1);
    expect(printed.indexOf("0001_create_entries.sql")).toBeGreaterThan(
      printed.indexOf("0001_create_users.sql"),
    );
    expect(await tablesIn(cwd, shopDb, "migrations")).toEqual(["users"]);
    expect(await tablesIn(cwd, logsDb, "logs")).toEqual(["entries"]);
  }, 120_000);

  test("stops at the first database whose migration fails, with Wrangler's code", async () => {
    const cwd = twoDatabases();
    writeFileSync(join(cwd, "migrations/0002_broken.sql"), "CREATE TABLE users (id INTEGER);\n");

    const { code, printed } = await migrated(cwd);

    expect(code).not.toBe(0);
    expect(printed).not.toContain("0001_create_entries.sql");
    expect(await tablesIn(cwd, logsDb, "logs")).toEqual([]);
  }, 120_000);

  test("--remote refuses a database with no id before asking for any name", async () => {
    const cwd = twoDatabases();
    const databases = [shopDb, { ...logsDb, database_id: undefined, migrations_dir: "logs" }];
    writeFileSync(join(cwd, "wrangler.jsonc"), JSON.stringify({ d1_databases: databases }));

    const { code, printed, lines } = await migrated(cwd, { remote: true }, "shop");

    expect(printed).toBe("");
    expect([code, lines]).toEqual([
      1,
      ["LOGS has no database_id in wrangler.jsonc, which --remote needs"],
    ]);
  });

  test('skips a database set to "migrate": false', async () => {
    const cwd = twoDatabases({ migrate: false });

    const { code, printed } = await migrated(cwd);

    expect(code).toBe(0);
    expect(printed).not.toContain("0001_create_entries.sql");
    expect(await tablesIn(cwd, shopDb, "migrations")).toEqual(["users"]);
    expect(await tablesIn(cwd, logsDb, "logs")).toEqual([]);
  }, 120_000);

  test('--remote doesn\'t ask for a database set to "migrate": false', async () => {
    const { code, printed, lines } = await migrated(
      twoDatabases({ migrate: false }),
      { remote: true },
      "nope",
    );

    expect(printed).toContain("Remote database DB (shop, id local-shop)");
    expect(printed).not.toContain("LOGS");
    expect([code, lines]).toEqual([1, ["Not migrated."]]);
  });

  test('with every database set to "migrate": false, says so and succeeds', async () => {
    const cwd = project();
    const entries = { DB: { adapter: "d1", migrate: false } };
    writeFileSync(join(cwd, "arbor.jsonc"), JSON.stringify({ databases: entries }));

    const { code, printed, lines } = await migrated(cwd);

    expect([code, printed, lines]).toEqual([
      0,
      "",
      ['No database to migrate: each is set not to ("migrate": false)'],
    ]);
  });
});
