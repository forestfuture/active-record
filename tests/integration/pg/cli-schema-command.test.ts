import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { runSchema } from "../../../packages/active-record/cli/schema/command.ts";
import { writePgProject } from "../../support/pg-project.ts";
import { scratchDirs } from "../../support/scratch.ts";

const scratch = scratchDirs();

/** Runs `active-record schema` in the project, collecting what it prints. */
async function run(cwd: string, options: Parameters<typeof runSchema>[0] = {}) {
  const output: string[] = [];
  const code = await runSchema({ cwd, ...options }, (line) => output.push(line));
  return { code, output: output.join("\n") };
}

// `active-record schema` on a Postgres project (#285).
describe("active-record schema, on Postgres", () => {
  test("writes the schema from the migrations, naming pg-record's adapter and the binding", async () => {
    const cwd = writePgProject(
      scratch("pg-schema-", true),
      { HYPERDRIVE: {} },
      {
        "migrations/20261108090503_create_users.sql":
          "CREATE TABLE users (id UUID PRIMARY KEY, email TEXT NOT NULL, admin BOOLEAN NOT NULL DEFAULT false);",
      },
    );

    const { code, output } = await run(cwd);

    expect([code, output]).toEqual([
      0,
      "Wrote src/db/schema.ts (1 table) from migrations/\nWrote src/models/application-record.ts",
    ]);
    const schema = readFileSync(join(cwd, "src/db/schema.ts"), "utf8");
    expect(schema).toContain('import { pg } from "@forestfuture/pg-record";');
    expect(schema).toContain('adapter: pg({ binding: "HYPERDRIVE" }),');
    expect(schema).toContain("/** users — last changed by 20261108090503_create_users.sql */");
    expect(schema).toContain('admin: { type: "boolean", null: false, default: () => false },');
    expect((await run(cwd, { check: true })).code).toBe(0);
  });

  test("with several databases, writes one schema each, from each one's migrations folder", async () => {
    const cwd = writePgProject(
      scratch("pg-schema-", true),
      { HYPERDRIVE: {}, LOGS: { migrationsDir: "db/logs" } },
      {
        "migrations/1_users.sql": "CREATE TABLE users (id UUID PRIMARY KEY);",
        "db/logs/1_entries.sql": "CREATE TABLE entries (id BIGINT PRIMARY KEY);",
      },
    );

    const { code } = await run(cwd);

    expect(code).toBe(0);
    expect(readFileSync(join(cwd, "src/db/LOGS.ts"), "utf8")).toContain(
      'adapter: pg({ binding: "LOGS" }),',
    );
    expect(readFileSync(join(cwd, "src/db/HYPERDRIVE.ts"), "utf8")).toContain("users");
  });
});
