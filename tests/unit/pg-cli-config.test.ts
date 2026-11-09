import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { projectDatabases } from "../../packages/active-record/cli/project/config-file.ts";
import { cli } from "../../packages/pg-record/cli/plugin.ts";
import { scratchDirs } from "../support/scratch.ts";

const scratch = scratchDirs();

/** pg-record's databases in a project whose active-record.jsonc is `text`. */
function databasesIn(text: string) {
  const cwd = project({ "active-record.jsonc": text });
  const config = projectDatabases(cwd);
  if (typeof config === "string") throw new Error(config);
  return { cwd, result: cli.databases(config) };
}

/** A project with these files, by path. */
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
    const { cwd, result } = databasesIn(`{
      // The app's databases.
      "databases": {
        "HYPERDRIVE": { "adapter": "pg", "url": "postgres://localhost/shop", },
        "LOGS": { "adapter": "pg", "migrationsDir": "db/logs", "remoteUrl": "\${LOGS_URL}" },
      },
    }`);

    expect(result).toEqual({
      ok: true,
      file: join(cwd, "active-record.jsonc"),
      dir: cwd,
      databases: [
        {
          binding: "HYPERDRIVE",
          migrationsDir: "migrations",
          migrationsTable: "schema_migrations",
          entry: { adapter: "pg", url: "postgres://localhost/shop" },
        },
        {
          binding: "LOGS",
          migrationsDir: "db/logs",
          migrationsTable: "schema_migrations",
          entry: { adapter: "pg", migrationsDir: "db/logs", remoteUrl: "${LOGS_URL}" },
        },
      ],
    });
  });

  test("says which setting isn't a string", () => {
    const errorOf = (entry: string) => {
      const { result } = databasesIn(`{ "databases": { "DB": ${entry} } }`);
      return result.ok ? "read" : result.error;
    };

    expect(errorOf('{ "migrationsDir": 1 }')).toBe(
      "active-record.jsonc: databases.DB.migrationsDir isn't a string",
    );
    expect(errorOf('{ "url": false }')).toBe(
      "active-record.jsonc: databases.DB.url isn't a string",
    );
    expect(errorOf('{ "schemaUrl": 1 }')).toBe(
      "active-record.jsonc: databases.DB.schemaUrl isn't a string",
    );
  });
});
