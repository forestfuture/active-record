import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import {
  chosenDatabase,
  loadDatabases,
} from "../../../packages/active-record/cli/project/databases.ts";
import { scratchDirs } from "../../support/scratch.ts";

const scratch = scratchDirs();

/** A project in the repo (so it finds this repo's wrangler and library): its files, by path. */
function project(files: Record<string, string>): string {
  const cwd = scratch("wrangler-config-");
  for (const [path, text] of Object.entries(files)) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), text);
  }
  return cwd;
}

/** An `active-record.jsonc` declaring these databases. */
const config = (databases: Record<string, unknown>) => JSON.stringify({ databases });

/** A Wrangler config declaring these D1 entries. */
const wrangler = (...entries: Record<string, unknown>[]) =>
  JSON.stringify({ d1_databases: entries });

/** The database `--database` names, as a command chooses it, or what the command would print. */
async function chosen(cwd: string, database?: string) {
  const project = await loadDatabases(cwd);
  if (typeof project === "string") return project;
  const found = chosenDatabase(project, { database });
  return typeof found === "string" ? found : found.chosen;
}

// A project whose Worker is in another folder (a monorepo, say) names its Wrangler config (#306).
describe("a D1 database's wranglerConfig", () => {
  test("names the Wrangler config its database is read from, relative to active-record.jsonc", async () => {
    const root = project({
      "app/active-record.jsonc": config({
        DB: { adapter: "d1", wranglerConfig: "../worker/wrangler.jsonc" },
      }),
      "worker/wrangler.jsonc": wrangler({
        binding: "DB",
        database_id: "x",
        migrations_dir: "db-migrations",
      }),
    });

    expect(await chosen(join(root, "app"))).toEqual({
      binding: "DB",
      entry: { binding: "DB", database_id: "x", migrations_dir: "db-migrations" },
      configFile: join(root, "worker/wrangler.jsonc"),
      migrationsDir: join(root, "worker/db-migrations"),
    });
  });
});
