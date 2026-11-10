import { mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, test, vi } from "vite-plus/test";
import { loadDatabases } from "../../../packages/active-record/cli/project/adapters.ts";
import { cli } from "../../../packages/active-record/cli/adapters/d1/plugin.ts";
import { libraryPaths } from "../../support/library-paths.ts";
import { scratchDirs } from "../../support/scratch.ts";

const scratch = scratchDirs();

/** A project outside the repo: its files by path, each adapter's plugin found through tsconfig paths. */
function project(files: Record<string, string>): string {
  const cwd = scratch("adapters-", true);
  const paths = libraryPaths;
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

/** Each database's binding and adapter, or what the command would print. */
async function found(cwd: string, configPath?: string): Promise<string> {
  const project = await loadDatabases(cwd, configPath);
  if (typeof project === "string") return project;
  return project.databases
    .map(({ adapter, database }) => `${database.binding} on ${adapter.name}`)
    .join(", ");
}

// The project's active-record.jsonc names each database's adapter, as Rails' database.yml does (#301).
describe("the adapter the command uses", () => {
  test("is the one active-record.jsonc names", async () => {
    const d1 = project({
      "active-record.jsonc": config({ DB: { adapter: "d1" } }),
      "wrangler.jsonc": wrangler("DB"),
    });
    const pg = project({
      "active-record.jsonc": config({
        HYPERDRIVE: { adapter: "postgresql", url: "postgres://x/y" },
      }),
    });

    expect(await found(d1)).toBe("DB on d1");
    expect(await found(pg)).toBe("HYPERDRIVE on postgresql");
  });

  test("--config names another file, beside which D1 finds Wrangler's config", async () => {
    const cwd = project({
      "app/settings.jsonc": config({ DB: { adapter: "d1" } }),
      "app/wrangler.jsonc": wrangler("DB"),
    });

    expect(await found(cwd, "app/settings.jsonc")).toBe("DB on d1");
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
      'active-record.jsonc: databases.DB has no adapter (add "adapter": "d1" or "postgresql")',
    );
    expect(
      await found(project({ "active-record.jsonc": config({ DB: { adapter: "mysql" } }) })),
    ).toBe(
      'active-record.jsonc: databases.DB has the adapter "mysql", which isn\'t d1 or postgresql',
    );
  });

  // Each plugin reads only the entries for its adapter, so neither sees the other's (#305).
  test("databases on different adapters are each read by their own, in the file's order", async () => {
    const cwd = project({
      "active-record.jsonc": config({
        HYPERDRIVE: { adapter: "postgresql" },
        DB: { adapter: "d1" },
        LOGS: { adapter: "postgresql", migrationsDir: "logs" },
      }),
      "wrangler.jsonc": wrangler("DB"),
    });

    expect(await found(cwd)).toBe("HYPERDRIVE on postgresql, DB on d1, LOGS on postgresql");
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

    expect(await found(some)).toBe("LOGS on d1");
    expect(await found(missing)).toBe(
      "active-record.jsonc names LOGS, which isn't in wrangler.jsonc's d1_databases",
    );
    expect(await found(noWrangler)).toBe(
      "No wrangler.jsonc, wrangler.json or wrangler.toml beside active-record.jsonc",
    );
  });

  // A D1 database added to Wrangler's config, and not to active-record.jsonc, would go unseen.
  test("D1's databases the file doesn't name are noted, with how to add them", async () => {
    const one = project({
      "active-record.jsonc": config({ LOGS: { adapter: "d1" } }),
      "wrangler.jsonc": wrangler("DB", "LOGS"),
    });
    const two = project({
      "active-record.jsonc": config({ LOGS: { adapter: "d1" } }),
      "wrangler.jsonc": wrangler("DB", "LOGS", "AUDIT"),
    });
    const notes = async (cwd: string) => {
      const loaded = await loadDatabases(cwd);
      return typeof loaded === "string" ? loaded : loaded.notes;
    };

    expect(await notes(one)).toEqual([
      "wrangler.jsonc has the D1 database DB, which active-record.jsonc doesn't name; run `npx active-record init` to add it",
    ]);
    expect(await notes(two)).toEqual([
      "wrangler.jsonc has the D1 databases DB and AUDIT, which active-record.jsonc doesn't name; run `npx active-record init` to add them",
    ]);
  });

  // Every adapter the file names has its say, not only the first's (#305).
  test("with databases on two adapters, D1's notes still come", async () => {
    const cwd = project({
      "active-record.jsonc": config({
        HYPERDRIVE: { adapter: "postgresql" },
        LOGS: { adapter: "d1" },
      }),
      "wrangler.jsonc": wrangler("DB", "LOGS"),
    });

    const loaded = await loadDatabases(cwd);

    expect(typeof loaded === "string" ? loaded : loaded.notes).toEqual([
      "wrangler.jsonc has the D1 database DB, which active-record.jsonc doesn't name; run `npx active-record init` to add it",
    ]);
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
        "The D1 adapter needs Node 22.13 or later (23.4 on Node 23), for node:sqlite " +
          `(this is Node ${process.versions.node})`,
      );
    } finally {
      spy.mockRestore();
    }
  });

  // Every adapter the file names is checked, though a command may only use another's database (#305).
  test("one this Node can't run says why, though the file names another adapter first", async () => {
    const builtin = process.getBuiltinModule.bind(process);
    const spy = vi
      .spyOn(process, "getBuiltinModule")
      .mockImplementation(((id: string) =>
        id === "node:sqlite" ? undefined : builtin(id)) as never);
    const cwd = project({
      "active-record.jsonc": config({
        HYPERDRIVE: { adapter: "postgresql" },
        DB: { adapter: "d1" },
      }),
      "wrangler.jsonc": wrangler("DB"),
    });

    try {
      expect(await found(cwd)).toBe(
        "The D1 adapter needs Node 22.13 or later (23.4 on Node 23), for node:sqlite " +
          `(this is Node ${process.versions.node})`,
      );
    } finally {
      spy.mockRestore();
    }
  });
});
