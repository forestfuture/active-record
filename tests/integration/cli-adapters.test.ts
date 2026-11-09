import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, test, vi } from "vite-plus/test";
import { loadAdapter } from "../../packages/active-record/cli/project/adapters.ts";
import { cli } from "../../packages/d1-record/cli/plugin.ts";
import { libraryPaths } from "../support/library-paths.ts";
import { scratchDirs } from "../support/scratch.ts";

const scratch = scratchDirs();

/** pg-record's plugin, at its source in this repo, as a tsconfig `paths` entry. */
const pgPlugin = [new URL("../../packages/pg-record/cli/plugin.ts", import.meta.url).pathname];

/** A project outside the repo: its files by path, each adapter's plugin found through tsconfig paths. */
function project(files: Record<string, string>): string {
  const cwd = scratch("adapters-", true);
  const paths = { ...libraryPaths, "@forestfuture/pg-record/cli": pgPlugin };
  const all = {
    "tsconfig.json": JSON.stringify({ compilerOptions: { baseUrl: ".", paths } }),
    ...files,
  };
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), text);
  }
  return cwd;
}

/** An `active-record.jsonc` declaring these databases. */
const config = (databases: Record<string, unknown>) => JSON.stringify({ databases });

const wrangler = (...bindings: string[]) =>
  JSON.stringify({ d1_databases: bindings.map((binding) => ({ binding, database_id: "x" })) });

/** The adapter's name and its databases' bindings, or what the command would print. */
async function found(cwd: string, configPath?: string): Promise<string> {
  const adapter = await loadAdapter(cwd, configPath);
  if (typeof adapter === "string") return adapter;
  const databases = adapter.databases();
  if (!databases.ok) return `adapter ${adapter.name}: ${databases.error}`;
  return `adapter ${adapter.name}: ${databases.databases.map((each) => each.binding).join(", ")}`;
}

// The project's active-record.jsonc names each database's adapter, as Rails' database.yml does (#301).
describe("the adapter the command uses", () => {
  test("is the one active-record.jsonc names", async () => {
    const d1 = project({
      "active-record.jsonc": config({ DB: { adapter: "d1" } }),
      "wrangler.jsonc": wrangler("DB"),
    });
    const pg = project({
      "active-record.jsonc": config({ HYPERDRIVE: { adapter: "pg", url: "postgres://x/y" } }),
    });

    expect(await found(d1)).toBe("adapter d1: DB");
    expect(await found(pg)).toBe("adapter pg: HYPERDRIVE");
  });

  test("--config names another file, beside which D1 finds Wrangler's config", async () => {
    const cwd = project({
      "app/settings.jsonc": config({ DB: { adapter: "d1" } }),
      "app/wrangler.jsonc": wrangler("DB"),
    });

    expect(await found(cwd, "app/settings.jsonc")).toBe("adapter d1: DB");
    expect(await found(cwd, "app/missing.jsonc")).toBe("app/missing.jsonc isn't there");
  });

  test("without active-record.jsonc, says to run init", async () => {
    const cwd = project({ "wrangler.jsonc": wrangler("DB") });

    expect(await found(cwd)).toBe(
      "No active-record.jsonc here, which names the project's databases and their adapter: run `npx active-record init` to write one",
    );
  });

  test("a file with no databases, or one that isn't an object, says so", async () => {
    expect(await found(project({ "active-record.jsonc": "{}" }))).toBe(
      "active-record.jsonc has no databases",
    );
    expect(await found(project({ "active-record.jsonc": config({ DB: "d1" }) }))).toBe(
      "active-record.jsonc: databases.DB isn't an object",
    );
    expect(await found(project({ "active-record.jsonc": "[]" }))).toBe(
      "active-record.jsonc isn't an object",
    );
    expect(await found(project({ "active-record.jsonc": "{" }))).toMatch(
      /^active-record\.jsonc couldn't be read: /,
    );
  });

  test("a database without an adapter, or with one that isn't one, says which there are", async () => {
    expect(await found(project({ "active-record.jsonc": config({ DB: {} }) }))).toBe(
      'active-record.jsonc: databases.DB has no adapter (add "adapter": "d1" or "pg")',
    );
    expect(
      await found(project({ "active-record.jsonc": config({ DB: { adapter: "mysql" } }) })),
    ).toBe('active-record.jsonc: databases.DB has the adapter "mysql", which isn\'t d1 or pg');
  });

  // One adapter per project, for now (#305).
  test("databases on different adapters are refused", async () => {
    const cwd = project({
      "active-record.jsonc": config({ DB: { adapter: "d1" }, HYPERDRIVE: { adapter: "pg" } }),
    });

    expect(await found(cwd)).toBe(
      "active-record.jsonc names more than one adapter (d1 for DB, pg for HYPERDRIVE); a project uses one, for now",
    );
  });

  test("D1's databases are the ones it names, read from Wrangler's config", async () => {
    const some = project({
      "active-record.jsonc": config({ LOGS: { adapter: "d1" } }),
      "wrangler.jsonc": wrangler("DB", "LOGS"),
    });
    const missing = project({
      "active-record.jsonc": config({ DB: { adapter: "d1" }, LOGS: { adapter: "d1" } }),
      "wrangler.jsonc": wrangler("DB"),
    });
    const noWrangler = project({ "active-record.jsonc": config({ DB: { adapter: "d1" } }) });

    expect(await found(some)).toBe("adapter d1: LOGS");
    expect(await found(missing)).toBe(
      "adapter d1: active-record.jsonc names LOGS, which isn't in wrangler.jsonc's d1_databases",
    );
    expect(await found(noWrangler)).toBe(
      "adapter d1: No wrangler.jsonc, wrangler.json or wrangler.toml beside active-record.jsonc",
    );
  });

  test("D1's plugin runs on this Node, which has node:sqlite", () => {
    expect(cli.unsupported?.()).toBeUndefined();
  });

  // D1's schema reading needs node:sqlite, so its plugin refuses a Node without it, up front (#284).
  test("one this Node can't run says why as it loads, before anything is read", async () => {
    const builtin = process.getBuiltinModule.bind(process);
    const spy = vi
      .spyOn(process, "getBuiltinModule")
      .mockImplementation(((id: string) =>
        id === "node:sqlite" ? undefined : builtin(id)) as never);
    const cwd = project({
      "active-record.jsonc": config({ DB: { adapter: "d1" } }),
      "wrangler.jsonc": wrangler("DB"),
    });

    try {
      expect(await found(cwd)).toBe(
        "@forestfuture/d1-record needs Node 22.13 or later (23.4 on Node 23), for node:sqlite " +
          `(this is Node ${process.versions.node})`,
      );
    } finally {
      spy.mockRestore();
    }
  });
});
