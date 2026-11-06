import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { runSchema, watchSchema } from "../../packages/active-record/cli/schema/command.ts";
import { scratchDirs } from "../support/scratch.ts";

const scratch = scratchDirs();

/** A throwaway project, where its Models find this repo's library: its files, by path. */
function project(files: Record<string, string>): string {
  const dir = scratch("schema-");
  for (const [path, content] of Object.entries(files)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

/** Runs the command, collecting what it prints. */
async function run(cwd: string, options: Parameters<typeof runSchema>[0] = {}) {
  const output: string[] = [];
  const code = await runSchema({ cwd, ...options }, (line) => output.push(line));
  return { code, output: output.join("\n") };
}

/** Writes `sql` as the project's second migration. */
function writeMigration(cwd: string, sql: string): void {
  writeFileSync(join(cwd, "migrations/0002.sql"), sql);
}

/** The schema.ts the command generated. */
function generatedSchema(cwd: string): string {
  return readFileSync(join(cwd, "src/db/schema.ts"), "utf8");
}

/**
 * How watch tests poll. They write the migration on every poll, so a watcher that isn't watching
 * yet misses a write, not the test (#182). The interval is longer than the watcher's 50 ms wait,
 * so the writes don't keep putting off regenerating.
 */
const watchPoll = { timeout: 30_000, interval: 250 };

const wranglerJsonc = `{
  // A comment, as wrangler.jsonc allows.
  "name": "app",
  "d1_databases": [{ "binding": "DB", "database_name": "app-db", "database_id": "x" }],
}`;

describe("active-record schema", () => {
  test("writes src/db/schema.ts from the Wrangler config's migrations", async () => {
    const cwd = project({
      "wrangler.jsonc": wranglerJsonc,
      "migrations/0001_create_users.sql":
        "CREATE TABLE users (id TEXT PRIMARY KEY, email TEXT NOT NULL);",
      "migrations/0002_add_bio.sql": "ALTER TABLE users ADD COLUMN bio TEXT;",
    });

    const { code, output } = await run(cwd);

    const schema = readFileSync(join(cwd, "src/db/schema.ts"), "utf8");
    expect(code).toBe(0);
    expect(output).toBe(
      "Wrote src/db/schema.ts (1 table) from migrations/\nWrote src/models/application-record.ts",
    );
    expect(readFileSync(join(cwd, "src/models/application-record.ts"), "utf8")).toContain(
      'import { schema } from "../db/schema";',
    );
    expect(schema).toContain("/** users — last changed by 0002_add_bio.sql */");
    expect(schema).toContain('  bio: "string",');
  });

  test("reads wrangler.toml, and a database's own migrations_dir and migrations_table", async () => {
    const cwd = project({
      "wrangler.toml": `name = "app"

[[d1_databases]]
binding = "DB"
database_name = "app-db"
database_id = "x"
migrations_dir = "db/migrate"
migrations_table = "seen"
`,
      "db/migrate/0001_create.sql":
        "CREATE TABLE seen (id INTEGER PRIMARY KEY); CREATE TABLE posts (id INTEGER PRIMARY KEY);",
    });

    expect((await run(cwd)).code).toBe(0);
    const schema = readFileSync(join(cwd, "src/db/schema.ts"), "utf8");
    expect(schema).toContain("from db/migrate/");
    expect(schema).toContain("export const posts");
    expect(schema).not.toContain("export const seen");
  });

  test("writes one file per database when there are several, each with its own base class", async () => {
    const cwd = project({
      "wrangler.json": JSON.stringify({
        d1_databases: [
          { binding: "DB", database_name: "app" },
          { binding: "ANALYTICS", database_name: "stats", migrations_dir: "analytics-migrations" },
        ],
      }),
      "migrations/0001.sql": "CREATE TABLE users (id INTEGER PRIMARY KEY);",
      "analytics-migrations/0001.sql": "CREATE TABLE events (id INTEGER PRIMARY KEY);",
    });

    expect((await run(cwd)).code).toBe(0);
    expect(readFileSync(join(cwd, "src/db/DB.ts"), "utf8")).toContain("export const users");
    expect(readFileSync(join(cwd, "src/db/ANALYTICS.ts"), "utf8")).toContain("export const events");
    expect(existsSync(join(cwd, "src/db/schema.ts"))).toBe(false);
    expect(readFileSync(join(cwd, "src/models/db-record.ts"), "utf8")).toContain(
      'import { schema } from "../db/DB";\n',
    );
    expect(readFileSync(join(cwd, "src/models/analytics-record.ts"), "utf8")).toContain(
      "export abstract class AnalyticsRecord extends Model {",
    );
  });

  test("a missing base class is written even when the schema is up to date; --check writes nothing", async () => {
    const cwd = project({
      "wrangler.jsonc": wranglerJsonc,
      "migrations/0001.sql": "CREATE TABLE users (id INTEGER PRIMARY KEY);",
    });
    await run(cwd);
    rmSync(join(cwd, "src/models"), { recursive: true });

    expect((await run(cwd, { check: true })).output).toBe("src/db/schema.ts is up to date");
    expect(existsSync(join(cwd, "src/models"))).toBe(false);
    expect((await run(cwd)).output).toBe(
      "src/db/schema.ts is up to date (1 table)\nWrote src/models/application-record.ts",
    );
  });

  test("each binding's base class is named after it, and two that would share one are refused", async () => {
    const named = project({
      "wrangler.jsonc": '{ "d1_databases": [{ "binding": "MY_DB" }, { "binding": "Logs2" }] }',
      "migrations/0001.sql": "CREATE TABLE users (id INTEGER PRIMARY KEY);",
    });
    const shared = project({
      "wrangler.jsonc":
        '{ "d1_databases": [{ "binding": "DB" }, { "binding": "db", "migrations_dir": "other" }] }',
    });

    expect((await run(named)).output).toContain("Wrote src/models/my-db-record.ts");
    expect(readFileSync(join(named, "src/models/logs2-record.ts"), "utf8")).toContain(
      "export abstract class Logs2Record extends Model {",
    );
    expect(await run(shared)).toEqual({
      code: 1,
      output: "The bindings DB and db would share the base class DbRecord; rename one",
    });
  });

  test("a schema file next to a folder of its name (a Drizzle schema) is refused: it would take over its imports", async () => {
    const cwd = project({
      "wrangler.jsonc": wranglerJsonc,
      "migrations/0001.sql": "CREATE TABLE users (id INTEGER PRIMARY KEY);",
      "src/db/schema/index.ts": "export * from './users';",
    });

    expect(await run(cwd)).toEqual({
      code: 1,
      output:
        "src/db/schema.ts would take over imports of the folder src/db/schema/ (an import of schema finds the file first), so it isn't written; choose another file with --out, such as --out src/db/active-record.ts\nWrote nothing to src/db/schema.ts",
    });
    expect(existsSync(join(cwd, "src/db/schema.ts"))).toBe(false);
    expect((await run(cwd, { out: "src/db/d1-record.ts" })).code).toBe(0);
  });

  test("a file d1-record didn't write is never replaced", async () => {
    const drizzle = "export const users = sqliteTable('users', {});\n";
    const cwd = project({
      "wrangler.jsonc": wranglerJsonc,
      "migrations/0001.sql": "CREATE TABLE users (id INTEGER PRIMARY KEY);",
      "src/db/schema.ts": drizzle,
    });

    expect(await run(cwd)).toEqual({
      code: 1,
      output:
        "src/db/schema.ts wasn't written by active-record schema (it has no \"Generated by\" header), so it's left as it is; choose another file with --out, such as --out src/db/active-record.ts\nKept src/db/schema.ts as it was",
    });
    expect(readFileSync(join(cwd, "src/db/schema.ts"), "utf8")).toBe(drizzle);
  });

  test("the base class is written once, then it's the app's: never overwritten", async () => {
    const cwd = project({
      "wrangler.jsonc": wranglerJsonc,
      "migrations/0001.sql": "CREATE TABLE users (id INTEGER PRIMARY KEY);",
    });
    await run(cwd);
    writeFileSync(join(cwd, "src/models/application-record.ts"), "// edited\n");
    writeFileSync(join(cwd, "migrations/0002.sql"), "ALTER TABLE users ADD COLUMN name TEXT;");

    const { output } = await run(cwd);

    expect(output).toBe("Wrote src/db/schema.ts (1 table) from migrations/");
    expect(readFileSync(join(cwd, "src/models/application-record.ts"), "utf8")).toBe("// edited\n");
  });

  test("--out and --migrations choose other places", async () => {
    const cwd = project({
      "wrangler.jsonc": wranglerJsonc,
      "sql/0001.sql": "CREATE TABLE users (id INTEGER PRIMARY KEY);",
    });

    expect((await run(cwd, { out: "app/schema.ts", migrations: "sql" })).code).toBe(0);
    expect(readFileSync(join(cwd, "app/schema.ts"), "utf8")).toContain("export const users");
    expect(readFileSync(join(cwd, "src/models/application-record.ts"), "utf8")).toContain(
      'import { schema } from "../../app/schema";',
    );
  });

  test("--check passes when current, ignores formatting, and fails when a migration changed it", async () => {
    const cwd = project({
      "wrangler.jsonc": wranglerJsonc,
      "migrations/0001.sql": "CREATE TABLE users (id INTEGER PRIMARY KEY);",
    });
    await run(cwd);
    const path = join(cwd, "src/db/schema.ts");
    writeFileSync(path, readFileSync(path, "utf8").replaceAll("  ", "    ").replaceAll('"', "'"));

    const current = await run(cwd, { check: true });
    writeFileSync(join(cwd, "migrations/0002.sql"), "ALTER TABLE users ADD COLUMN name TEXT;");
    const stale = await run(cwd, { check: true });

    expect(current).toEqual({ code: 0, output: "src/db/schema.ts is up to date" });
    expect(stale.code).toBe(1);
    expect(stale.output).toBe("src/db/schema.ts is out of date: run `active-record schema`");
  });

  test("a broken migration is reported, and the last good schema.ts is kept", async () => {
    const cwd = project({
      "wrangler.jsonc": wranglerJsonc,
      "migrations/0001.sql": "CREATE TABLE users (id INTEGER PRIMARY KEY);",
    });
    await run(cwd);
    const before = readFileSync(join(cwd, "src/db/schema.ts"), "utf8");
    writeFileSync(join(cwd, "migrations/0002.sql"), "ALTER TABLE user ADD COLUMN x TEXT;");

    const { code, output } = await run(cwd);

    expect(code).toBe(1);
    expect(output).toMatch(
      /^0002\.sql: .*no such table: user\nKept src\/db\/schema\.ts as it was$/,
    );
    expect(readFileSync(join(cwd, "src/db/schema.ts"), "utf8")).toBe(before);
  });

  test("no Wrangler config, or no D1 database in it, says so", async () => {
    expect(await run(project({ "readme.md": "" }))).toEqual({
      code: 1,
      output: "No wrangler.jsonc, wrangler.json or wrangler.toml here (pass --config)",
    });
    expect(await run(project({ "wrangler.jsonc": "{}" }))).toEqual({
      code: 1,
      output: "wrangler.jsonc has no d1_databases",
    });
  });

  test("a Wrangler config it can't use says why", async () => {
    expect(
      await run(project({ "wrangler.jsonc": '{ /* never closed "d1_databases": [] }' })),
    ).toEqual({
      code: 1,
      output: "wrangler.jsonc couldn't be read: Unterminated /* comment",
    });
    expect(
      await run(project({ "wrangler.jsonc": '{ "d1_databases": [{ "database_name": "x" }] }' })),
    ).toEqual({
      code: 1,
      output: "wrangler.jsonc has a d1_databases entry with no binding",
    });
  });

  test("reads wrangler.toml's spaced and commented headers, and its escaped strings", async () => {
    const cwd = project({
      "wrangler.toml": `[[ d1_databases ]] # the app's database
binding = "DB"
migrations_dir = "db\\u002Fmigrate"
`,
      "db/migrate/0001.sql": "CREATE TABLE users (id INTEGER PRIMARY KEY);",
    });

    expect(await run(cwd)).toMatchObject({ code: 0, output: expect.stringMatching(/^Wrote/) });
  });

  test("reads nested migrations through the config's migrations_pattern", async () => {
    const cwd = project({
      "wrangler.jsonc": `{ "d1_databases": [{ "binding": "DB", "migrations_pattern": "migrations/*/migration.sql" }] }`,
      "migrations/0001_init/migration.sql": "CREATE TABLE users (id INTEGER PRIMARY KEY);",
      "migrations/0002_bio/migration.sql": "ALTER TABLE users ADD COLUMN bio TEXT;",
      "migrations/0002_bio/notes.md": "Not a migration.",
    });

    const { code } = await run(cwd);

    const schema = readFileSync(join(cwd, "src/db/schema.ts"), "utf8");
    expect(code).toBe(0);
    expect(schema).toContain("/** users — last changed by 0002_bio/migration.sql */");
  });

  test("migrations from Drizzle get notes on the columns worth checking", async () => {
    const cwd = project({
      "wrangler.jsonc": `{ "d1_databases": [{ "binding": "DB", "migrations_dir": "drizzle" }] }`,
      "drizzle.config.ts": "export default {};",
      "drizzle/0000_init.sql":
        "CREATE TABLE posts (id INTEGER PRIMARY KEY, published_at INTEGER);\n--> statement-breakpoint\nCREATE INDEX i ON posts (published_at);",
    });

    const { code, output } = await run(cwd);

    expect(code).toBe(0);
    expect(output.split("\n").slice(2)).toEqual([
      expect.stringMatching(
        /^Note: these migrations look like Drizzle's\. Some columns may convert/,
      ),
      'Note: posts.published_at: read as an integer; if it holds a Unix timestamp, override it in its Model as { type: "datetime", storage: "unixSeconds" ("timestamp") or "unixMilliseconds" ("timestamp_ms") }',
    ]);
  });

  test("a Prisma migration's CURRENT_TIMESTAMP default is noted through the command (#143)", async () => {
    const cwd = project({
      "wrangler.jsonc": `{ "d1_databases": [{ "binding": "DB", "migrations_dir": "migrations" }] }`,
      "prisma/schema.prisma": "model Post { id Int @id }",
      "migrations/0001_init.sql":
        'CREATE TABLE "Post" ("id" INTEGER NOT NULL PRIMARY KEY, "createdAt" DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);',
    });

    const { code, output } = await run(cwd);

    expect(code).toBe(0);
    expect(output).toContain(
      "Note: Post.createdAt: its default writes the database's own date text (2026-10-12 06:38:30)",
    );
  });

  test("Wrangler's own migrations get no note for a CURRENT_TIMESTAMP default, since it's a hint (#143)", async () => {
    const cwd = project({
      "wrangler.jsonc": `{ "d1_databases": [{ "binding": "DB", "migrations_dir": "migrations" }] }`,
      "migrations/0001_init.sql":
        "CREATE TABLE posts (id INTEGER PRIMARY KEY, created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP);",
    });

    const { code, output } = await run(cwd);

    expect(code).toBe(0);
    expect(output).not.toContain("date text");
  });

  test("notes come with a file that's written, not again when it's up to date, or with --check", async () => {
    const cwd = project({
      "wrangler.jsonc": wranglerJsonc,
      "drizzle.config.ts": "export default {};",
      "migrations/0000_init.sql":
        "CREATE TABLE posts (id INTEGER PRIMARY KEY, published_at INTEGER);",
    });

    const first = await run(cwd);
    const again = await run(cwd);
    const checked = await run(cwd, { check: true });

    expect(first.output).toContain("Note: posts.published_at");
    expect(again.output).toBe("src/db/schema.ts is up to date (1 table)");
    expect(checked.output).toBe("src/db/schema.ts is up to date");
  });

  test("migrations in folders, as Drizzle writes them, get the hint to set migrations_pattern", async () => {
    const cwd = project({
      "wrangler.jsonc": wranglerJsonc,
      "migrations/0000_init/migration.sql": "CREATE TABLE posts (id INTEGER PRIMARY KEY);",
    });

    expect((await run(cwd)).output).toBe(`Wrote src/db/schema.ts (0 tables) from migrations/
Wrote src/models/application-record.ts
Note: migrations/ has its migrations in folders, as Drizzle writes them; set migrations_pattern to "migrations/*/migration.sql" in wrangler.jsonc, so they're read`);
  });

  test("--watch regenerates when a migration changes", async () => {
    const cwd = project({
      "wrangler.jsonc": wranglerJsonc,
      "migrations/0001.sql": "CREATE TABLE users (id INTEGER PRIMARY KEY);",
    });
    const stop = await watchSchema({ cwd }, () => {});

    await expect
      .poll(() => {
        writeMigration(cwd, "ALTER TABLE users ADD COLUMN name TEXT;");
        return generatedSchema(cwd);
      }, watchPoll)
      .toContain('  name: "string",');
    stop();
  }, 60_000);

  test("--watch carries on after a broken migration, and regenerates once it's fixed", async () => {
    const cwd = project({
      "wrangler.jsonc": wranglerJsonc,
      "migrations/0001.sql": "CREATE TABLE users (id INTEGER PRIMARY KEY);",
    });
    const output: string[] = [];
    const stop = await watchSchema({ cwd }, (line) => output.push(line));
    await expect
      .poll(() => {
        writeMigration(cwd, "ALTER TABLE user ADD COLUMN name TEXT;");
        return output.join("\n");
      }, watchPoll)
      .toContain("no such table: user");

    await expect
      .poll(() => {
        writeMigration(cwd, "ALTER TABLE users ADD COLUMN name TEXT;");
        return generatedSchema(cwd);
      }, watchPoll)
      .toContain('  name: "string",');
    stop();
  }, 60_000);
});

describe("active-record schema, with Models", () => {
  /** A project whose schema and base class were generated, with these Model files added. */
  async function withModels(models: Record<string, string>, migrations = usersMigration) {
    const cwd = project({ "wrangler.jsonc": wranglerJsonc, ...migrations });
    await run(cwd);
    for (const [path, source] of Object.entries(models)) {
      writeFileSync(join(cwd, "src/models", path), source);
    }
    return cwd;
  }

  const usersMigration = {
    "migrations/0001.sql":
      "CREATE TABLE users (id INTEGER PRIMARY KEY, email TEXT NOT NULL);" +
      "CREATE TABLE posts (id INTEGER PRIMARY KEY, title TEXT);",
  };
  const base = 'import { ApplicationRecord } from "./application-record";\n';

  test("with Models but no migrations folder, says so and keeps the schema", async () => {
    const cwd = await withModels({
      "user.ts": `${base}export class User extends ApplicationRecord {}\n`,
    });
    rmSync(join(cwd, "migrations"), { recursive: true });

    expect(await run(cwd)).toEqual({
      code: 1,
      output: "No migrations folder at migrations/\nKept src/db/schema.ts as it was",
    });
  });

  test("lists the Models it finds, and adds each one's attributes to its class", async () => {
    const cwd = await withModels({
      "user.ts": `${base}export class User extends ApplicationRecord {}\n`,
      "post.ts": `${base}export class Post extends ApplicationRecord {
  static { this.validates("title", { presence: true }); }
}
export class FeaturedPost extends Post {}
`,
    });

    const { code, output } = await run(cwd);

    const schema = generatedSchema(cwd);
    expect([code, output]).toEqual([0, "Wrote src/db/schema.ts (2 tables) from migrations/"]);
    expect(schema).toContain('  models: { Post: "posts", User: "users" },');
    expect(schema).toContain(
      'declare module "../models/user" {\n  interface User extends TableAttributes<typeof users',
    );
    expect(schema).not.toContain("FeaturedPost");
  });

  test("doesn't list classes Models are built on, or Models declaring their own attributes", async () => {
    const cwd = await withModels({
      "shared.ts": `${base}export abstract class Shared extends ApplicationRecord {
  static override abstract = true;
}
export class User extends Shared {}
export class Visit extends ApplicationRecord.define({ id: "integer" }) {}
`,
    });

    await run(cwd);

    expect(generatedSchema(cwd)).toContain('  models: { User: "users" },');
  });

  test("a Model whose table the migrations don't make fails, and the last good file is kept", async () => {
    const cwd = await withModels({
      "account.ts": `${base}export class Account extends ApplicationRecord {}\n`,
    });
    const before = generatedSchema(cwd);

    const { code, output } = await run(cwd);

    expect(code).toBe(1);
    expect(output).toBe(
      "src/models/account.ts: Account's table, accounts, isn't in the generated schema\n" +
        "Kept src/db/schema.ts as it was",
    );
    expect(generatedSchema(cwd)).toBe(before);
  });

  test("a Model file that can't be loaded is reported by its file", async () => {
    const cwd = await withModels({ "user.ts": "export class User extends {}\n" });

    const { code, output } = await run(cwd);

    expect(code).toBe(1);
    expect(output).toMatch(
      /^Couldn't load src\/models\/user\.ts: .+\nKept src\/db\/schema\.ts as it was$/s,
    );
  });

  test("an override of an attribute the table doesn't have is reported by its file", async () => {
    const cwd = await withModels({
      "user.ts": `${base}export class User extends ApplicationRecord {
  static override attributes = { emial: "string" } as const;
}
`,
    });

    const { code, output } = await run(cwd);

    expect([code, output]).toEqual([
      1,
      "src/models/user.ts: User has no attribute emial to override\nKept src/db/schema.ts as it was",
    ]);
  });

  test("a Model exported as the default is refused, asking for a named export", async () => {
    const cwd = await withModels({
      "user.ts": `${base}export default class User extends ApplicationRecord {}\n`,
    });

    const { code, output } = await run(cwd);

    expect(code).toBe(1);
    expect(output).toBe(
      "src/models/user.ts exports User as its default; export it by name (export class User …), " +
        "so active-record schema can add its attributes\nKept src/db/schema.ts as it was",
    );
  });

  test("a missing schema file is written again, with the Models that import it", async () => {
    const cwd = await withModels({
      "user.ts": `${base}export class User extends ApplicationRecord {}\n`,
    });
    rmSync(join(cwd, "src/db/schema.ts"));

    const { code } = await run(cwd);

    expect(code).toBe(0);
    expect(generatedSchema(cwd)).toContain('  models: { User: "users" },');
  });

  test("a Model whose name isn't an identifier is refused, since its name is written as code", async () => {
    const cwd = await withModels({
      "user.ts": `${base}export class User extends ApplicationRecord {
  static override table = "users";
  static { Object.defineProperty(this, "name", { value: "User Account" }); }
}
`,
    });

    const { code, output } = await run(cwd);

    expect(code).toBe(1);
    expect(output).toBe(
      'src/models/user.ts exports a Model named "User Account", which isn\'t a name ' +
        "active-record schema can write as code; name the class with letters, digits, _ and $\n" +
        "Kept src/db/schema.ts as it was",
    );
  });

  test("--check with no schema file writes nothing, and says it's out of date", async () => {
    const cwd = await withModels({
      "user.ts": `${base}export class User extends ApplicationRecord {}\n`,
    });
    rmSync(join(cwd, "src/db"), { recursive: true });

    const { code, output } = await run(cwd, { check: true });

    expect([code, output]).toEqual([
      1,
      "src/db/schema.ts is out of date: run `active-record schema`",
    ]);
    expect(existsSync(join(cwd, "src/db"))).toBe(false);
  });

  test("--check fails when a Model was added since the schema was generated", async () => {
    const cwd = await withModels({});
    writeFileSync(
      join(cwd, "src/models/user.ts"),
      `${base}export class User extends ApplicationRecord {}\n`,
    );

    const { code, output } = await run(cwd, { check: true });

    expect([code, output]).toEqual([
      1,
      "src/db/schema.ts is out of date: run `active-record schema`",
    ]);
  });

  test("--watch regenerates when a Model file changes", async () => {
    const cwd = await withModels({});
    const stop = await watchSchema({ cwd }, () => {});

    await expect
      .poll(() => {
        writeFileSync(
          join(cwd, "src/models/user.ts"),
          `${base}export class User extends ApplicationRecord {}\n`,
        );
        return generatedSchema(cwd);
      }, watchPoll)
      .toContain('  models: { User: "users" },');
    stop();
  }, 60_000);
});
