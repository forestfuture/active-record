import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import {
  chosenDatabase,
  loadDatabases,
} from "../../../packages/active-record/cli/project/databases.ts";
import { runSchema } from "../../../packages/active-record/cli/schema/command.ts";
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

  test("is refused when it isn't a string, isn't there, is a folder, or doesn't have the binding", async () => {
    const refusal = async (wranglerConfig: unknown) => {
      const root = project({
        "app/active-record.jsonc": config({ DB: { adapter: "d1", wranglerConfig } }),
        "worker/wrangler.jsonc": wrangler({ binding: "LOGS", database_id: "x" }),
      });
      return chosen(join(root, "app"));
    };

    expect(await refusal(42)).toBe(
      "active-record.jsonc: databases.DB.wranglerConfig isn't a string",
    );
    expect(await refusal("../worker/wrangler.toml")).toBe(
      "active-record.jsonc: databases.DB.wranglerConfig names ../worker/wrangler.toml, which isn't there",
    );
    expect(await refusal("../worker")).toBe(
      "active-record.jsonc: databases.DB.wranglerConfig names ../worker, which is a folder; name its wrangler.jsonc, wrangler.json or wrangler.toml",
    );
    expect(await refusal("../worker/wrangler.jsonc")).toBe(
      "active-record.jsonc names DB, which isn't in ../worker/wrangler.jsonc's d1_databases",
    );
  });

  test("lets databases read different Wrangler configs, each its own migrations from its own folder", async () => {
    const root = project({
      "app/active-record.jsonc": config({
        DB: { adapter: "d1" },
        LOGS: { adapter: "d1", wranglerConfig: "../logger/wrangler.toml" },
      }),
      "app/wrangler.jsonc": wrangler({ binding: "DB", database_id: "x" }),
      "logger/wrangler.toml": '[[d1_databases]]\nbinding = "LOGS"\ndatabase_id = "y"\n',
    });
    const app = join(root, "app");
    const where = async (binding: string) => {
      const found = await chosen(app, binding);
      return typeof found === "string" ? found : [found.configFile, found.migrationsDir];
    };

    expect(await where("DB")).toEqual([join(app, "wrangler.jsonc"), join(app, "migrations")]);
    expect(await where("LOGS")).toEqual([
      join(root, "logger/wrangler.toml"),
      join(root, "logger/migrations"),
    ]);
  });

  test("needs no Wrangler config beside the file when every database names its own", async () => {
    const root = project({
      "app/active-record.jsonc": config({
        DB: { adapter: "d1", wranglerConfig: "../worker/wrangler.jsonc" },
      }),
      "worker/wrangler.jsonc": wrangler({ binding: "DB", database_id: "x" }),
    });
    const beside = project({
      "app/active-record.jsonc": config({
        DB: { adapter: "d1", wranglerConfig: "../worker/wrangler.jsonc" },
        LOGS: { adapter: "d1" },
      }),
      "worker/wrangler.jsonc": wrangler({ binding: "DB", database_id: "x" }),
    });

    expect(await chosen(join(root, "app"))).toMatchObject({ binding: "DB" });
    expect(await chosen(join(beside, "app"), "DB")).toBe(
      "No wrangler.jsonc, wrangler.json or wrangler.toml beside active-record.jsonc",
    );
  });

  // init reads only the config beside the file, so it can't add these; the note says how.
  test("notes the databases the config it names has that the file doesn't, with the line that adds them", async () => {
    const root = project({
      "app/active-record.jsonc": config({
        DB: { adapter: "d1", wranglerConfig: "../worker/wrangler.jsonc" },
      }),
      "app/wrangler.jsonc": wrangler({ binding: "UNUSED", database_id: "z" }),
      "worker/wrangler.jsonc": wrangler(
        { binding: "DB", database_id: "x" },
        { binding: "LOGS", database_id: "y" },
      ),
    });

    const loaded = await loadDatabases(join(root, "app"));

    expect(typeof loaded === "string" ? loaded : loaded.notes).toEqual([
      '../worker/wrangler.jsonc has the D1 database LOGS, which active-record.jsonc doesn\'t name; add it with "wranglerConfig": "../worker/wrangler.jsonc"',
    ]);
  });
});

/** Runs `active-record schema` in `cwd`: its code, and what it printed. */
async function schema(cwd: string) {
  const output: string[] = [];
  const code = await runSchema({ cwd }, (line) => output.push(line));
  return { code, output };
}

describe("active-record schema, with a database's wranglerConfig", () => {
  test("reads the migrations beside that config, as its migrations_pattern finds them", async () => {
    const root = project({
      "app/active-record.jsonc": config({
        DB: { adapter: "d1", wranglerConfig: "../worker/wrangler.jsonc" },
      }),
      "worker/wrangler.jsonc": wrangler({
        binding: "DB",
        database_id: "x",
        migrations_pattern: "migrations/*/migration.sql",
      }),
      "worker/migrations/0001_users/migration.sql": "CREATE TABLE users (id TEXT PRIMARY KEY);",
    });
    const app = join(root, "app");

    const { code, output } = await schema(app);

    expect([code, output[0]]).toEqual([
      0,
      "Wrote src/db/schema.ts (1 table) from ../worker/migrations/",
    ]);
    expect(readFileSync(join(app, "src/db/schema.ts"), "utf8")).toContain(
      "/** users — last changed by 0001_users/migration.sql */",
    );
  });

  // Drizzle is found from each database's own folder, not only from the first one's.
  test("notes Drizzle's migrations for the database whose config's folder has drizzle.config.ts", async () => {
    const root = project({
      "app/active-record.jsonc": config({
        DB: { adapter: "d1" },
        LOGS: { adapter: "d1", wranglerConfig: "../worker/wrangler.jsonc" },
      }),
      "app/wrangler.jsonc": wrangler({ binding: "DB", database_id: "x" }),
      "app/migrations/0001_posts.sql": "CREATE TABLE posts (id INTEGER PRIMARY KEY);",
      "worker/wrangler.jsonc": wrangler({ binding: "LOGS", database_id: "y" }),
      "worker/drizzle.config.ts": "export default {};",
      "worker/migrations/0000_init.sql":
        "CREATE TABLE events (id INTEGER PRIMARY KEY, logged_at INTEGER);",
    });

    const { code, output } = await schema(join(root, "app"));

    expect(code).toBe(0);
    expect(output).toContainEqual(
      expect.stringMatching(/^Note: events\.logged_at: read as an integer/),
    );
  });
});
