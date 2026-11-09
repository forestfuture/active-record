import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { cli } from "../../packages/pg-record/cli/plugin.ts";
import { scratchDirs } from "../support/scratch.ts";

const scratch = scratchDirs();

/** A project with this `active-record.jsonc` (or file, by path). */
function project(files: Record<string, string>): string {
  const cwd = scratch("pg-config-", true);
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(join(cwd, path, ".."), { recursive: true });
    writeFileSync(join(cwd, path), text);
  }
  return cwd;
}

// Postgres's databases are declared in the project's own config file (#285).
describe("pg-record's databases, from active-record.jsonc", () => {
  test("are its databases, by binding, with comments and trailing commas", () => {
    const cwd = project({
      "active-record.jsonc": `{
        // The app's databases.
        "databases": {
          "HYPERDRIVE": { "url": "postgres://localhost/shop", },
          "LOGS": { "migrationsDir": "db/logs", "remoteUrl": "\${LOGS_URL}" },
        },
      }`,
    });

    expect(cli.databases(cwd)).toEqual({
      ok: true,
      file: join(cwd, "active-record.jsonc"),
      dir: cwd,
      databases: [
        {
          binding: "HYPERDRIVE",
          migrationsDir: "migrations",
          migrationsTable: "schema_migrations",
          entry: { url: "postgres://localhost/shop" },
        },
        {
          binding: "LOGS",
          migrationsDir: "db/logs",
          migrationsTable: "schema_migrations",
          entry: { migrationsDir: "db/logs", remoteUrl: "${LOGS_URL}" },
        },
      ],
    });
  });

  test("--config names another file, whose folder its paths are relative to", () => {
    const cwd = project({ "app/settings.jsonc": '{ "databases": { "DB": {} } }' });

    expect(cli.databases(cwd, "app/settings.jsonc")).toMatchObject({
      ok: true,
      file: join(cwd, "app/settings.jsonc"),
      dir: join(cwd, "app"),
    });
  });

  test("says what's wrong with a file it can't use", () => {
    const errorOf = (text: string) => {
      const result = cli.databases(project({ "active-record.jsonc": text }));
      return result.ok ? "read" : result.error;
    };

    expect(errorOf("{")).toMatch(/^active-record\.jsonc couldn't be read: /);
    expect(errorOf("{}")).toBe("active-record.jsonc has no databases");
    expect(errorOf('{ "databases": { "DB": "postgres://localhost/shop" } }')).toBe(
      "active-record.jsonc: databases.DB isn't an object",
    );
    expect(errorOf('{ "databases": { "DB": { "migrationsDir": 1 } } }')).toBe(
      "active-record.jsonc: databases.DB.migrationsDir isn't a string",
    );
    expect(errorOf('{ "databases": { "DB": { "url": false } } }')).toBe(
      "active-record.jsonc: databases.DB.url isn't a string",
    );
    expect(errorOf('{ "databases": { "DB": { "schemaUrl": 1 } } }')).toBe(
      "active-record.jsonc: databases.DB.schemaUrl isn't a string",
    );
  });

  test("with no file, says to write one or pass --config", () => {
    expect(cli.databases(project({}))).toEqual({
      ok: false,
      error: "No active-record.jsonc here, which declares the Postgres databases (pass --config)",
    });
  });
});
