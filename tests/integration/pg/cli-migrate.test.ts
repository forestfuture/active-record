import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vite-plus/test";
import { runMigrate } from "../../../packages/active-record/cli/migrate/command.ts";
import { openPgSchema, type PgSchema } from "../../support/pg.ts";
import { writePgProject, type PgDatabases } from "../../support/pg-project.ts";
import { scratchDirs } from "../../support/scratch.ts";

const scratch = scratchDirs();

const createUsers = {
  "migrations/20261108090503_create_users.sql":
    "CREATE TABLE users (id UUID PRIMARY KEY, email TEXT NOT NULL);",
  "migrations/20261108090504_add_name_to_users.sql": "ALTER TABLE users ADD COLUMN name TEXT;",
};

/** Runs `migrate` with these options, as from a pipe unless `typed`; its code and its output. */
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

// `active-record migrate` applies a Postgres database's pending migrations itself (#285).
describe("migrate, on Postgres", () => {
  let schema: PgSchema;
  beforeAll(async () => {
    schema = await openPgSchema([]);
  });
  afterAll(() => schema.dispose());
  afterEach(async () => {
    await schema.pool.query({ text: "DROP TABLE IF EXISTS users, posts, schema_migrations" });
  });

  /** A project whose one database is this schema, by url, with these migrations. */
  const project = (files: Record<string, string>, databases?: PgDatabases) =>
    writePgProject(scratch("pg-migrate-", true), databases ?? { DB: { url: schema.url } }, files);

  /** The versions the runner recorded, in order. */
  async function versions(): Promise<unknown[]> {
    const { rows } = await schema.pool.query({
      text: "SELECT version FROM schema_migrations ORDER BY version",
    });
    return rows.map((row) => row["version"]);
  }

  test("applies the pending migrations in order, and records each one's version", async () => {
    const { code, printed } = await migrated(project(createUsers));

    expect([code, printed]).toEqual([
      0,
      [
        "Local database DB (active_record_test on localhost)",
        "Applied 20261108090503_create_users.sql",
        "Applied 20261108090504_add_name_to_users.sql",
        "",
      ].join("\n"),
    ]);
    expect(await versions()).toEqual(["20261108090503", "20261108090504"]);
    const { rows } = await schema.pool.query({
      text: "SELECT column_name FROM information_schema.columns WHERE table_schema = current_schema() AND table_name = 'users' ORDER BY ordinal_position",
    });
    expect(rows.map((row) => row["column_name"])).toEqual(["id", "email", "name"]);
  });

  test("has nothing to do the second time, and applies only what's new after", async () => {
    const cwd = project(createUsers);
    await migrated(cwd);

    expect((await migrated(cwd)).printed).toBe(
      "Local database DB (active_record_test on localhost)\nNo migrations to apply\n",
    );
    writeFileSync(
      join(cwd, "migrations/20261108090505_create_posts.sql"),
      "CREATE TABLE posts (id UUID PRIMARY KEY);",
    );
    expect((await migrated(cwd)).printed).toContain("Applied 20261108090505_create_posts.sql\n");
    expect(await versions()).toHaveLength(3);
  });

  test("a migration that fails is rolled back, with its version, and the ones after it don't run", async () => {
    const cwd = project({
      "migrations/1_create_users.sql": "CREATE TABLE users (id UUID PRIMARY KEY);",
      "migrations/2_broken.sql":
        "CREATE TABLE posts (id UUID PRIMARY KEY); ALTER TABLE nowhere ADD x TEXT;",
      "migrations/3_later.sql": "ALTER TABLE users ADD COLUMN later TEXT;",
    });

    const { code, printed } = await migrated(cwd);

    expect(code).toBe(1);
    expect(printed).toBe(
      'Local database DB (active_record_test on localhost)\nApplied 1_create_users.sql\n2_broken.sql failed: relation "nowhere" does not exist\n',
    );
    expect(await versions()).toEqual(["1"]);
    const { rows } = await schema.pool.query({ text: "SELECT to_regclass('posts') AS posts" });
    expect(rows).toEqual([{ posts: null }]);
  });

  test("two at once apply each migration once", async () => {
    const cwd = project(createUsers);

    const both = await Promise.all([migrated(cwd), migrated(cwd)]);

    expect(both.map(({ code }) => code)).toEqual([0, 0]);
    expect(await versions()).toEqual(["20261108090503", "20261108090504"]);
  });

  test("a migration whose file name has no version is refused before any runs", async () => {
    const { code, printed } = await migrated(
      project({ ...createUsers, "migrations/notes.sql": "SELECT 1;" }),
    );

    expect([code, printed]).toEqual([
      1,
      "notes.sql has no version: start its name with one, as the generators do (20261108090503_create_products.sql)\n",
    ]);
  });

  test("without a url, says to set one", async () => {
    const { code, printed } = await migrated(project(createUsers, { DB: {} }));

    expect([code, printed]).toEqual([
      1,
      "DB has no url in active-record.jsonc, which migrate needs for the local database\n",
    ]);
  });

  describe("--remote", () => {
    afterEach(() => void vi.unstubAllEnvs());

    /** A project whose real database is this schema, named by an environment variable. */
    function remoteProject(): string {
      vi.stubEnv("PRODUCTION_DATABASE_URL", schema.url);
      return project(createUsers, { DB: { remoteUrl: "${PRODUCTION_DATABASE_URL}" } });
    }

    test("asks for the database's name first, and migrates once it's typed", async () => {
      const cwd = remoteProject();

      const refused = await migrated(cwd, { remote: true }, "nope");
      expect(refused.printed).toContain("Remote database DB (active_record_test on localhost)");
      expect([refused.code, refused.lines]).toEqual([1, ["Not migrated."]]);

      const { code, printed } = await migrated(cwd, { remote: true }, "active_record_test");
      expect([code, printed]).toEqual([
        0,
        expect.stringContaining("Applied 20261108090504_add_name_to_users.sql\n"),
      ]);
    });

    test("--yes migrates without asking, and the password is never printed", async () => {
      const cwd = remoteProject();

      const { code, printed } = await migrated(cwd, { remote: true, yes: true });

      expect(code).toBe(0);
      expect(printed).not.toContain(new URL(schema.url).password || "no password here");
    });

    test("a database with no remoteUrl is refused, before asking", async () => {
      const { code, lines } = await migrated(project(createUsers), { remote: true });

      expect([code, lines]).toEqual([
        1,
        ["DB has no remoteUrl in active-record.jsonc, which --remote needs"],
      ]);
    });
  });
});
