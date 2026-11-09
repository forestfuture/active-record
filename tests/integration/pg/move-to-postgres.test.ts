import { cpSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, onTestFinished, test, vi } from "vite-plus/test";
import { libraryPaths } from "../../support/library-paths.ts";
import { writePgProject } from "../../support/pg-project.ts";
import { scratchDirs } from "../../support/scratch.ts";
import { command, serve, type Served } from "../../support/worker-app.ts";

const source = (path: string) => [new URL(`../../../packages/${path}`, import.meta.url).pathname];
const app = new URL("../../../site/snippets/getting-started/", import.meta.url).pathname;
// The files the guide writes for Postgres.
const move = new URL("../../../site/snippets/move-to-postgres/", import.meta.url).pathname;
/** The local database the guide's files name, which the test's own database stands in for. */
const guideUrl = "postgres://localhost:5432/my_app";

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
    "@forestfuture/pg-record": source("pg-record/src/index.ts"),
    "@forestfuture/pg-record/cli": source("pg-record/cli/plugin.ts"),
  };
  writeFileSync(join(cwd, "tsconfig.json"), JSON.stringify({ compilerOptions: { paths } }));
  return cwd;
}

/** A generated schema without the line naming its migrations' hash. */
const withoutHash = (schema: string) => schema.replace(/^\/\/ schema: \w+$/m, "");

// The Getting started app moves from D1 to Postgres as the Moving to Postgres guide moves it, with
// its Models and code unchanged (#270).
describe("moving the Getting started app from D1 to Postgres", { timeout: 60_000 }, () => {
  let cwd: string;
  let onD1: Served;

  beforeAll(() => {
    cwd = copyOfTheApp();
  });
  afterAll(async () => {
    await onD1?.dispose();
  });

  test("on D1, the app signs up users and lists them", async () => {
    expect(await command(cwd, ["migrate"])).toMatchObject({ code: 0 });
    onD1 = await serve(cwd, {
      d1Databases: { DB: "…" },
      d1Persist: join(cwd, ".wrangler/state/v3/d1"),
    });

    const signups = [];
    for (const email of ["Ada@example.com", "grace@example.com", "ada@example.com"]) {
      signups.push((await onD1.fetch("POST", { email })).status);
    }
    const listed = await onD1.fetch("GET");

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
      readFileSync(join(move, "active-record.jsonc"), "utf8").replaceAll(
        guideUrl,
        "postgres://localhost/unused",
      ),
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
    expect([file, readFileSync(join(cwd, "migrations", file), "utf8")]).toEqual([
      file,
      readFileSync(join(move, "migrations", file), "utf8"),
    ]);
  }
});
