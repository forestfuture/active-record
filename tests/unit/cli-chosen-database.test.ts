import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, test } from "vite-plus/test";
import { projectDatabases } from "../../packages/active-record/cli/project/config-file.ts";
import { chosenDatabase } from "../../packages/active-record/cli/project/databases.ts";
import { cli } from "../../packages/active-record/cli/adapters/d1/plugin.ts";
import { remoteTarget } from "../../packages/active-record/cli/adapters/d1/remote.ts";

/** The database chosen in a D1 project, or why there isn't one. */
function databaseFor(cwd: string, options: { config?: string; database?: string }) {
  const project = projectDatabases(cwd, options.config);
  if (typeof project === "string") return project;
  return chosenDatabase({ ...cli, databases: () => cli.databases(project) }, cwd, options);
}

/** An `active-record.jsonc` naming these D1 databases. */
const config = (...bindings: string[]) =>
  JSON.stringify({
    databases: Object.fromEntries(bindings.map((each) => [each, { adapter: "d1" }])),
  });

const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** A project folder with a Wrangler config binding these D1 databases. */
function project(...bindings: string[]): string {
  const dir = mkdtempSync(join(tmpdir(), "console-db-"));
  made.push(dir);
  const d1_databases = bindings.map((binding) => ({ binding, database_name: `${binding}-name` }));
  writeFileSync(join(dir, "wrangler.jsonc"), JSON.stringify({ d1_databases }));
  writeFileSync(join(dir, "active-record.jsonc"), config(...bindings));
  return dir;
}

describe("the database the console opens", () => {
  test("the only one, with the config file Wrangler should read", () => {
    const cwd = project("DB");

    expect(databaseFor(cwd, {})).toEqual({
      binding: "DB",
      entry: { binding: "DB", database_name: "DB-name" },
      configFile: join(cwd, "wrangler.jsonc"),
      migrationsDir: join(cwd, "migrations"),
    });
  });

  test("with several, the one --database names, as the config declares it", () => {
    const cwd = project("DB", "LOGS");

    expect(databaseFor(cwd, { database: "LOGS" })).toEqual({
      binding: "LOGS",
      entry: { binding: "LOGS", database_name: "LOGS-name" },
      configFile: join(cwd, "wrangler.jsonc"),
      migrationsDir: join(cwd, "migrations"),
    });
  });

  // A migration runner needs the folder, as the config has it, beside the config (#284).
  test("with its migrations folder, from beside the config file", () => {
    const cwd = mkdtempSync(join(tmpdir(), "console-db-"));
    made.push(cwd);
    mkdirSync(join(cwd, "app"));
    const d1_databases = [{ binding: "DB", migrations_dir: "db/migrations" }];
    writeFileSync(join(cwd, "app/wrangler.jsonc"), JSON.stringify({ d1_databases }));
    writeFileSync(join(cwd, "app/active-record.jsonc"), config("DB"));

    expect(databaseFor(cwd, { config: "app/active-record.jsonc" })).toMatchObject({
      migrationsDir: join(cwd, "app/db/migrations"),
    });
  });

  test("no config says so", () => {
    const cwd = mkdtempSync(join(tmpdir(), "console-db-"));
    made.push(cwd);

    expect(databaseFor(cwd, {})).toMatch(/^No active-record\.jsonc here/);
  });
});

// What `--remote` would open, which it names before asking and before any sign-in.
describe("the remote database a binding points at", () => {
  const configFile = "/project/wrangler.jsonc";
  const migrationsDir = "/project/migrations";

  test("is its database_id, named by its database_name", () => {
    const entry = { binding: "DB", database_name: "shop", database_id: "1a2b" };

    expect(remoteTarget({ binding: "DB", entry, configFile, migrationsDir })).toEqual({
      name: "shop",
      description: "Remote database DB (shop, id 1a2b)",
    });
  });

  test("is the preview_database_id when there is one, as Wrangler uses it", () => {
    const entry = {
      binding: "DB",
      database_name: "shop",
      database_id: "1a2b",
      preview_database_id: "9z",
    };

    expect(remoteTarget({ binding: "DB", entry, configFile, migrationsDir })).toEqual({
      name: "shop",
      description: "Remote preview database DB (shop, id 9z)",
      note: "That is the config's preview_database_id, which Wrangler opens in place of database_id.",
    });
  });

  test("is named by the binding when the config gives no database_name", () => {
    const entry = { binding: "DB", database_id: "1a2b" };

    expect(remoteTarget({ binding: "DB", entry, configFile, migrationsDir })).toMatchObject({
      name: "DB",
    });
  });

  test("is named by the binding when the database_name is empty", () => {
    const entry = { binding: "DB", database_name: "", database_id: "1a2b" };

    expect(remoteTarget({ binding: "DB", entry, configFile, migrationsDir })).toMatchObject({
      name: "DB",
    });
  });

  test("is none when the config gives no id, which --remote needs", () => {
    const entry = { binding: "DB", database_name: "shop" };

    expect(remoteTarget({ binding: "DB", entry, configFile, migrationsDir })).toBe(
      "DB has no database_id in wrangler.jsonc, which --remote needs",
    );
  });
});
