import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { loadAdapter } from "../../packages/active-record/cli/project/adapters.ts";
import { libraryPaths } from "../support/library-paths.ts";
import { scratchDirs } from "../support/scratch.ts";

const scratch = scratchDirs();

/** A project outside the repo: its files by path, D1's plugin found through tsconfig paths. */
function project(files: Record<string, string>): string {
  const cwd = scratch("adapters-", true);
  const all = {
    "tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths: libraryPaths } }),
    ...files,
  };
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), text);
  }
  return cwd;
}

/** A stand-in Postgres adapter, installed in the project's node_modules with a plugin of its own. */
const pgInstalled = {
  "node_modules/@forestfuture/pg-record/package.json": JSON.stringify({
    name: "@forestfuture/pg-record",
    type: "module",
    exports: { "./cli": "./cli.js" },
  }),
  "node_modules/@forestfuture/pg-record/cli.js": 'export const cli = { name: "pg" };',
};

const manifest = (...packages: string[]) =>
  JSON.stringify({ dependencies: Object.fromEntries(packages.map((name) => [name, "*"])) });

/** The adapter's name, or what the command would print. */
async function found(cwd: string, named?: string): Promise<string> {
  const adapter = await loadAdapter(cwd, named);
  return typeof adapter === "string" ? adapter : `adapter ${adapter.name}`;
}

// The command finds its adapter from the project (#278), so one command works on every database.
describe("the adapter the command uses", () => {
  test("is the one the project's package.json lists", async () => {
    const cwd = project({ "package.json": manifest("@forestfuture/d1-record"), ...pgInstalled });

    expect(await found(cwd)).toBe("adapter d1");
  });

  test("with none listed, is the one installed", async () => {
    expect(await found(project({ "package.json": "{}" }))).toBe("adapter d1");
  });

  test("with several, needs --adapter, which chooses one", async () => {
    const listed = manifest("@forestfuture/d1-record", "@forestfuture/pg-record");
    const cwd = project({ "package.json": listed, ...pgInstalled });

    expect(await found(cwd)).toBe(
      "Several adapters are installed here (d1 or pg); choose one with --adapter",
    );
    expect(await found(cwd, "pg")).toBe("adapter pg");
    expect(await found(cwd, "d1")).toBe("adapter d1");
  });

  test("an --adapter that isn't installed, or isn't one, says so", async () => {
    const cwd = project({});

    expect(await found(cwd, "pg")).toBe(
      "@forestfuture/pg-record isn't installed here (install it, then try again)",
    );
    expect(await found(cwd, "mysql")).toBe("--adapter takes d1 or pg, not mysql");
  });

  test("with no adapter installed, says what to install", async () => {
    const cwd = scratch("no-adapter-", true);

    expect(await found(cwd)).toBe(
      "No adapter is installed here: install one, such as @forestfuture/d1-record, then try again",
    );
  });

  test("a plugin that fails to load is reported as that, not as missing", async () => {
    const cwd = project({
      "node_modules/@forestfuture/pg-record/package.json":
        pgInstalled["node_modules/@forestfuture/pg-record/package.json"],
      "node_modules/@forestfuture/pg-record/cli.js": 'throw new Error("boom");',
    });

    expect(await found(cwd, "pg")).toBe("Couldn't load @forestfuture/pg-record/cli: boom");
  });
});
