import { cpSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { libraryPaths } from "../../support/library-paths.ts";
import { scratchDirs } from "../../support/scratch.ts";
import { command, serve, type Served } from "../../support/worker-app.ts";

const source = (path: string) => [new URL(`../../../packages/${path}`, import.meta.url).pathname];
const app = new URL("../../../site/snippets/getting-started/", import.meta.url).pathname;

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
});
