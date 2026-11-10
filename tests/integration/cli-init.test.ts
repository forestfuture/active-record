import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { runInit } from "../../packages/active-record/cli/init/command.ts";
import { loadAdapter } from "../../packages/active-record/cli/project/adapters.ts";
import { parseJsonc } from "../../packages/active-record/cli/project/config-file.ts";
import { libraryPaths } from "../support/library-paths.ts";
import { scratchDirs } from "../support/scratch.ts";

const scratch = scratchDirs();

/** A project outside the repo, named `shop`: its files by path, each plugin found through paths. */
function project(files: Record<string, string> = {}): string {
  const cwd = join(scratch("init-", true), "shop");
  const paths = libraryPaths;
  const all = { "tsconfig.json": JSON.stringify({ compilerOptions: { paths } }), ...files };
  for (const [path, text] of Object.entries(all)) {
    mkdirSync(dirname(join(cwd, path)), { recursive: true });
    writeFileSync(join(cwd, path), text);
  }
  return cwd;
}

/** Runs `init` with these options: its exit code, and what it printed. */
async function init(cwd: string, options: { adapter?: string; config?: string } = {}) {
  const lines: string[] = [];
  const code = await runInit({ cwd, ...options }, (line) => lines.push(line));
  return { code, output: lines.join("\n") };
}

/** The `active-record.jsonc` it wrote, read. */
const written = (cwd: string, file = "active-record.jsonc") =>
  parseJsonc(readFileSync(join(cwd, file), "utf8"));

const schemaLink = "./node_modules/@forestfuture/active-record/config-schema.json";

// A project's active-record.jsonc names its databases and their adapter; init writes it (#301).
describe("active-record init", () => {
  test("on D1, names each of Wrangler's D1 databases, which the command then uses", async () => {
    const cwd = project({
      "wrangler.jsonc": JSON.stringify({
        d1_databases: [{ binding: "DB" }, { binding: "LOGS", migrations_dir: "logs" }],
      }),
    });

    expect(await init(cwd)).toEqual({
      code: 0,
      output: "Wrote active-record.jsonc (DB and LOGS, on d1)\nNext: npx active-record schema",
    });
    expect(written(cwd)).toEqual({
      $schema: schemaLink,
      databases: { DB: { adapter: "d1" }, LOGS: { adapter: "d1" } },
    });
    const adapter = await loadAdapter(cwd);
    expect(typeof adapter === "string" ? adapter : adapter.databases()).toMatchObject({
      ok: true,
      databases: [{ binding: "DB" }, { binding: "LOGS", migrationsDir: "logs" }],
    });
  });

  test("on Postgres, names Wrangler's Hyperdrive binding, with its local connection string", async () => {
    const hyperdrive = { binding: "HYPERDRIVE", localConnectionString: "postgres://localhost/s" };
    const cwd = project({ "wrangler.jsonc": JSON.stringify({ hyperdrive: [hyperdrive] }) });

    expect(await init(cwd)).toEqual({
      code: 0,
      output:
        "Wrote active-record.jsonc (HYPERDRIVE, on postgresql)\nNext: npx active-record schema",
    });
    expect(written(cwd)).toEqual({
      $schema: schemaLink,
      databases: { HYPERDRIVE: { adapter: "postgresql", url: "postgres://localhost/s" } },
    });
  });

  test("a Hyperdrive binding without a local connection string gets a guess, noted", async () => {
    const cwd = project({ "wrangler.jsonc": '{ "hyperdrive": [{ "binding": "HYPERDRIVE" }] }' });

    expect(await init(cwd)).toEqual({
      code: 0,
      output:
        "Wrote active-record.jsonc (HYPERDRIVE, on postgresql)\n" +
        "Note: HYPERDRIVE has no localConnectionString in wrangler.jsonc, so its url is a guess " +
        "(postgres://localhost:5432/shop_development); set it to your local database\n" +
        "Next: npx active-record schema",
    });
  });

  test("--adapter postgresql with nothing to read names DATABASE_URL, on a local database named as Rails names it", async () => {
    const cwd = project();

    expect(await init(cwd, { adapter: "postgresql" })).toEqual({
      code: 0,
      output:
        "Wrote active-record.jsonc (DATABASE_URL, on postgresql)\n" +
        "Note: DATABASE_URL's url is a guess (postgres://localhost:5432/shop_development); set it to your local database\n" +
        "Next: npx active-record schema",
    });
    expect(written(cwd)).toEqual({
      $schema: schemaLink,
      databases: {
        DATABASE_URL: { adapter: "postgresql", url: "postgres://localhost:5432/shop_development" },
      },
    });
  });

  test("--adapter chooses, when Wrangler's config has both", async () => {
    const cwd = project({
      "wrangler.jsonc": JSON.stringify({
        d1_databases: [{ binding: "DB" }],
        hyperdrive: [{ binding: "HYPERDRIVE" }],
      }),
    });

    expect(await init(cwd)).toEqual({
      code: 1,
      output: "This project could use d1 or postgresql; choose one with --adapter",
    });
    expect(existsSync(join(cwd, "active-record.jsonc"))).toBe(false);
    expect((await init(cwd, { adapter: "d1" })).code).toBe(0);
    expect(written(cwd)).toMatchObject({ databases: { DB: { adapter: "d1" } } });
  });

  test("with nothing to read and no --adapter, says to choose one", async () => {
    expect(await init(project())).toEqual({
      code: 1,
      output:
        "Nothing here says which database the project uses; choose d1 or postgresql with --adapter",
    });
  });

  test("--adapter d1 without D1 databases says where to declare them", async () => {
    const cwd = project({ "wrangler.jsonc": "{}" });

    expect(await init(cwd, { adapter: "d1" })).toEqual({
      code: 1,
      output: "wrangler.jsonc has no d1_databases: declare your database there first",
    });
  });

  test("an --adapter that isn't one says which there are", async () => {
    expect(await init(project(), { adapter: "mysql" })).toEqual({
      code: 1,
      output: "--adapter takes d1 or postgresql, not mysql",
    });
  });

  test("never writes over a file that's there", async () => {
    const cwd = project({
      "active-record.jsonc": "// mine\n{}",
      "wrangler.jsonc": JSON.stringify({ d1_databases: [{ binding: "DB" }] }),
    });

    expect(await init(cwd)).toEqual({
      code: 1,
      output: "active-record.jsonc is already here; init writes nothing over it",
    });
    expect(readFileSync(join(cwd, "active-record.jsonc"), "utf8")).toBe("// mine\n{}");
  });

  // A link where the file goes, even to nothing yet, is a file that's there: init never follows it.
  test("never writes through a link that's there, though it points at nothing", async () => {
    const cwd = project({
      "wrangler.jsonc": JSON.stringify({ d1_databases: [{ binding: "DB" }] }),
    });
    const target = join(cwd, "..", "elsewhere.jsonc");
    symlinkSync(target, join(cwd, "active-record.jsonc"));

    expect(await init(cwd)).toEqual({
      code: 1,
      output: "active-record.jsonc is already here; init writes nothing over it",
    });
    expect(existsSync(target)).toBe(false);
  });

  test("--config writes another file, reading Wrangler's config beside it", async () => {
    const cwd = project({
      "app/wrangler.jsonc": JSON.stringify({ d1_databases: [{ binding: "DB" }] }),
    });

    expect(await init(cwd, { config: "app/active-record.jsonc" })).toMatchObject({ code: 0 });
    expect(written(cwd, "app/active-record.jsonc")).toEqual({
      $schema: `.${schemaLink}`,
      databases: { DB: { adapter: "d1" } },
    });
  });
});
