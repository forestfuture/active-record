import { execFileSync, spawnSync } from "node:child_process";
import { cpSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { afterAll, beforeAll, describe, expect, onTestFinished, test, vi } from "vite-plus/test";
import { libraryPaths } from "../../support/library-paths.ts";
import { openPgDatabase, type PgDatabase } from "../../support/pg.ts";
import { writePgProject } from "../../support/pg-project.ts";
import { scratchDirs } from "../../support/scratch.ts";
import { command, runWrangler, serve, type Served } from "../../support/worker-app.ts";

/** A package entry at its source in this repo, as a tsconfig `paths` entry. */
const sourcePaths = (path: string) => [
  new URL(`../../../packages/${path}`, import.meta.url).pathname,
];
const app = new URL("../../../site/snippets/getting-started/", import.meta.url).pathname;
// The files the guide writes for Postgres.
const move = new URL("../../../site/snippets/move-to-postgres/", import.meta.url).pathname;
/** The local database the guide's files name, which the test's own database stands in for. */
const guideUrl = "postgres://user:password@localhost:5432/my_app";

/** This repo's installed commands, such as wrangler, as an app's are on its scripts' PATH. */
const bin = new URL("../../../node_modules/.bin", import.meta.url).pathname;

// In the repo, so the app finds this repo's Wrangler, as an app finds its own.
const scratch = scratchDirs();

/** The app's package.json, with these adapters as its dependencies. */
function packageJson(cwd: string, adapters: string[]): void {
  const dependencies = Object.fromEntries(
    ["@forestfuture/active-record", ...adapters].map((name) => [name, "*"]),
  );
  writeFileSync(join(cwd, "package.json"), JSON.stringify({ dependencies }, null, 2));
}

/**
 * A copy of the Getting started app. Its tsconfig finds every package at its source in this repo,
 * as an app's node_modules would once each is installed; package.json says which are.
 */
function copyOfTheApp(): string {
  const cwd = scratch("move-");
  cpSync(app, cwd, { recursive: true });
  packageJson(cwd, ["@forestfuture/d1-record"]);
  const paths = {
    ...libraryPaths,
    "@forestfuture/pg-record": sourcePaths("pg-record/src/index.ts"),
    "@forestfuture/pg-record/cli": sourcePaths("pg-record/cli/plugin.ts"),
  };
  writeFileSync(join(cwd, "tsconfig.json"), JSON.stringify({ compilerOptions: { paths } }));
  return cwd;
}

/** Rows from the app's local D1, as Wrangler reads them. */
function d1Rows(cwd: string, sql: string): Record<string, unknown>[] {
  const [result] = JSON.parse(
    runWrangler(cwd, ["d1", "execute", "DB", "--local", "--json", "--command", sql]),
  ) as { results: Record<string, unknown>[] }[];
  return result!.results;
}

/**
 * A row as plain values, where D1 and Postgres return the same value differently: each `_at`
 * time as ISO text (D1's text, Postgres's Date), and `is_active` as a boolean (D1's 1).
 */
function plain(row: Record<string, unknown>): Record<string, unknown> {
  const value = (column: string, cell: unknown) => {
    if (cell === null) return null;
    if (column.endsWith("_at")) return new Date(cell as string | Date).toISOString();
    return column === "is_active" ? Boolean(cell) : cell;
  };
  return Object.fromEntries(
    Object.entries(row).map(([column, cell]) => [column, value(column, cell)]),
  );
}

/** A URL with a password, which Hyperdrive requires, even for a server that asks for none. */
function withPassword(url: string): string {
  const withOne = new URL(url);
  if (withOne.password === "") withOne.password = "unused";
  return withOne.toString();
}

/** The files in `dir`, by their path in it, leaving out what Wrangler and the test write there. */
const filesIn = (dir: string) =>
  readdirSync(dir, { recursive: true, withFileTypes: true })
    .filter((entry) => entry.isFile())
    .map((entry) => relative(dir, join(entry.parentPath, entry.name)))
    .filter((file) => !/^\.(?:wrangler|bundle)\//.test(file))
    .sort();

/** Expects `file` to read the same in both folders. */
function expectSameFile(file: string, dir: string, other: string): void {
  expect([file, readFileSync(join(dir, file), "utf8")]).toEqual([
    file,
    readFileSync(join(other, file), "utf8"),
  ]);
}

/** A generated schema without the line naming its migrations' hash. */
const withoutHash = (schema: string) => schema.replace(/^\/\/ schema: \w+$/m, "");

// The Getting started app moves from D1 to Postgres as the Moving to Postgres guide moves it, with
// its Models and code unchanged (#270).
describe("moving the Getting started app from D1 to Postgres", { timeout: 60_000 }, () => {
  let cwd: string;
  let onD1: Served;
  let onPostgres: Served;
  let listedOnD1: unknown;
  let database: PgDatabase;

  beforeAll(async () => {
    cwd = copyOfTheApp();
    database = await openPgDatabase();
  });
  afterAll(async () => {
    await onD1?.dispose();
    await onPostgres?.dispose();
    await database?.dispose();
  });

  test("on D1, the app signs up users and lists them", async () => {
    expect(await command(cwd, ["migrate"])).toMatchObject({ code: 0 });
    onD1 = await serve(cwd);

    const signups = [];
    for (const email of ["Ada@example.com", "grace@example.com", "ada@example.com"]) {
      signups.push((await onD1.fetch("POST", { email })).status);
    }
    const listed = await onD1.fetch("GET");
    listedOnD1 = listed.body;

    expect(signups).toEqual([201, 201, 422]);
    expect((listed.body as { email: string }[]).map((user) => user.email)).toEqual([
      "grace@example.com",
      "ada@example.com",
    ]);
  });

  test("with pg-record installed, the schema regenerates from Postgres migrations, its adapter all that changes", async () => {
    const onD1Schema = readFileSync(join(cwd, "src/db/schema.ts"), "utf8");
    packageJson(cwd, ["@forestfuture/d1-record", "@forestfuture/pg-record"]);
    writeFileSync(
      join(cwd, "active-record.jsonc"),
      readFileSync(join(move, "active-record.jsonc"), "utf8").replaceAll(guideUrl, database.url),
    );
    rmSync(join(cwd, "migrations"), { recursive: true });
    cpSync(join(move, "migrations"), join(cwd, "migrations"), { recursive: true });

    const schema = await command(cwd, ["schema", "--adapter", "pg"]);

    expect(schema).toMatchObject({ code: 0 });
    const onPostgres = readFileSync(join(cwd, "src/db/schema.ts"), "utf8");
    expect(withoutHash(onPostgres)).toBe(
      withoutHash(onD1Schema)
        .replace(
          'import { d1 } from "@forestfuture/d1-record";',
          'import { pg } from "@forestfuture/pg-record";',
        )
        .replace('adapter: d1({ binding: "DB" })', 'adapter: pg({ binding: "HYPERDRIVE" })'),
    );
  });

  test("migrate --adapter pg creates the tables on Postgres", async () => {
    const migrated = await command(cwd, ["migrate", "--adapter", "pg"]);

    expect(migrated).toMatchObject({ code: 0 });
    const { rows } = await database.pool.query({
      text: "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
    });
    expect(rows.map((row) => row["tablename"])).toEqual(["posts", "schema_migrations", "users"]);
  });

  test("with Hyperdrive bound beside D1, copy-data.sh copies every row as D1 holds it, empty text as empty text", async () => {
    // A post the app can't write, with an empty title, in a NOT NULL column.
    d1Rows(
      cwd,
      "INSERT INTO posts (id, user_id, title, created_at, updated_at) " +
        "SELECT '00000000-0000-4000-8000-000000000000', id, '', created_at, updated_at FROM users " +
        "WHERE email = 'grace@example.com'",
    );
    writeFileSync(
      join(cwd, "wrangler.jsonc"),
      readFileSync(join(move, "wrangler.jsonc"), "utf8").replaceAll(guideUrl, hyperdriveUrl()),
    );

    execFileSync("sh", [join(move, "copy-data.sh"), "--local", "users", "posts"], {
      cwd,
      env: { ...process.env, DATABASE_URL: database.url, PATH: `${bin}:${process.env["PATH"]}` },
      stdio: "pipe",
    });

    for (const table of ["users", "posts"]) {
      const query = `SELECT * FROM ${table} ORDER BY id`;
      const { rows } = await database.pool.query({ text: query });
      const onD1Rows = d1Rows(cwd, query).map(plain);
      expect([table, (rows as Record<string, unknown>[]).map(plain)]).toEqual([table, onD1Rows]);
    }
    const titles = await database.pool.query({ text: "SELECT title FROM posts" });
    expect(titles.rows.map((row) => row["title"])).toContain("");
  });

  test("on Hyperdrive, the same code lists the same users, and signs up more", async () => {
    onPostgres = await serve(cwd);

    const listed = await onPostgres.fetch("GET");
    const signedUp = await onPostgres.fetch("POST", { email: "Hedy@example.com" });
    const again = await onPostgres.fetch("POST", { email: "hedy@example.com" });
    const after = await onPostgres.fetch("GET");

    expect(listed).toEqual({ status: 200, body: listedOnD1 });
    expect([signedUp.status, again]).toEqual([
      201,
      { status: 422, body: { errors: ["Email has already been taken"] } },
    ]);
    expect((after.body as { email: string }[]).map((user) => user.email)).toEqual([
      "hedy@example.com",
      "grace@example.com",
      "ada@example.com",
    ]);
  });

  test("with d1-record removed, the command finds pg-record without --adapter", async () => {
    packageJson(cwd, ["@forestfuture/pg-record"]);

    expect(await command(cwd, ["schema", "--check"])).toMatchObject({ code: 0 });
  });

  test("the move changed only the migrations, the schema and the Wrangler config, and added only active-record.jsonc", () => {
    const moved = ["src/db/schema.ts", "wrangler.jsonc"];
    const unchanged = filesIn(app).filter(
      (file) => !file.startsWith("migrations/") && !moved.includes(file),
    );
    // package.json and tsconfig.json stand in for the app's own, which the guide's npm commands change.
    const added = ["active-record.jsonc", "package.json", "tsconfig.json"];

    for (const file of unchanged) expectSameFile(file, cwd, app);
    expect(unchanged).toEqual(
      expect.arrayContaining(["src/index.ts", "src/models/user.ts", "src/models/post.ts"]),
    );
    expect(filesIn(cwd)).toEqual(
      [
        ...unchanged,
        ...moved,
        ...filesIn(move).filter((file) => file.startsWith("migrations/")),
        ...added,
      ].sort(),
    );
  });

  /** The Hyperdrive binding's local URL: the test's database, with a password Hyperdrive requires. */
  const hyperdriveUrl = () => withPassword(database.url);
});

test("the guide's Postgres migrations are what the tutorial's g model commands write on Postgres", async () => {
  const cwd = writePgProject(scratch("move-generate-", true), { HYPERDRIVE: { url: guideUrl } });
  // Migrations are named for the UTC second they're written in, so the clock is set.
  vi.useFakeTimers({ toFake: ["Date"] });
  onTestFinished(() => void vi.useRealTimers());

  vi.setSystemTime(new Date("2026-11-08T09:05:03Z"));
  await command(cwd, ["g", "model", "User", "email:string!:unique", "isActive:boolean!=true"]);
  vi.setSystemTime(new Date("2026-11-08T09:05:04Z"));
  await command(cwd, [
    "g",
    "model",
    "Post",
    "user:references",
    "title:string!",
    "publishedAt:datetime",
  ]);

  for (const file of ["20261108090503_create_users.sql", "20261108090504_create_posts.sql"]) {
    expectSameFile(`migrations/${file}`, cwd, move);
  }
});

test("copy-data.sh refuses a table name that would end the SQL it's written into, before exporting anything", () => {
  const cwd = scratch("move-names-");

  const refused = spawnSync("sh", [join(move, "copy-data.sh"), "--local", "users", 'posts" (id)'], {
    cwd,
    encoding: "utf8",
  });

  expect([refused.status, refused.stderr]).toEqual([
    1,
    `copy-data.sh: can't copy a table named 'posts" (id)'\n`,
  ]);
});
