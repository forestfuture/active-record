import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { describe, expect, test } from "vite-plus/test";
import { runInit } from "../../../packages/active-record/cli/init/command.ts";
import { loadAdapter } from "../../../packages/active-record/cli/project/adapters.ts";
import { parseJsonc } from "../../../packages/active-record/cli/project/config-file.ts";
import { libraryPaths } from "../../support/library-paths.ts";
import { scratchDirs } from "../../support/scratch.ts";

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

  test("on Postgres, reads Hyperdrive bindings from wrangler.toml too", async () => {
    const cwd = project({
      "wrangler.toml": [
        'name = "shop"',
        "",
        "[[hyperdrive]] # the database",
        'binding = "HYPERDRIVE"',
        'id = "1a2b"',
        "localConnectionString = 'postgres://localhost/s'",
        "",
        "[vars]",
        'binding = "NOT_A_DATABASE"',
      ].join("\n"),
    });

    expect(await init(cwd)).toMatchObject({ code: 0 });
    expect(written(cwd)).toMatchObject({
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

  // Run again, init adds the databases the file doesn't name, and leaves the rest as written (#301).
  describe("on a project that has the file", () => {
    const wrangler = (...bindings: string[]) =>
      JSON.stringify({ d1_databases: bindings.map((binding) => ({ binding })) });

    test("adds each database it's missing, keeping the file's comments and layout", async () => {
      const cwd = project({
        "active-record.jsonc": [
          "// The app's databases.",
          "{",
          '  "databases": {',
          "    // The main one.",
          '    "DB": { "adapter": "d1" } // keep',
          "  }",
          "}",
          "",
        ].join("\n"),
        "wrangler.jsonc": wrangler("DB", "LOGS", "AUDIT"),
      });

      expect(await init(cwd)).toEqual({
        code: 0,
        output: "Added LOGS and AUDIT to active-record.jsonc (on d1)",
      });
      expect(readFileSync(join(cwd, "active-record.jsonc"), "utf8")).toBe(
        [
          "// The app's databases.",
          "{",
          '  "databases": {',
          "    // The main one.",
          '    "DB": { "adapter": "d1" }, // keep',
          '    "LOGS": { "adapter": "d1" },',
          '    "AUDIT": { "adapter": "d1" }',
          "  }",
          "}",
          "",
        ].join("\n"),
      );
    });

    test("keeps its trailing commas", async () => {
      const cwd = project({
        "active-record.jsonc": '{\n  "databases": {\n    "DB": { "adapter": "d1" },\n  },\n}\n',
        "wrangler.jsonc": wrangler("DB", "LOGS"),
      });

      expect((await init(cwd)).code).toBe(0);
      expect(readFileSync(join(cwd, "active-record.jsonc"), "utf8")).toBe(
        '{\n  "databases": {\n    "DB": { "adapter": "d1" },\n    "LOGS": { "adapter": "d1" },\n  },\n}\n',
      );
    });

    test("with nothing missing, writes nothing", async () => {
      const text = '{ "databases": { "DB": { "adapter": "d1" } } }';
      const cwd = project({ "active-record.jsonc": text, "wrangler.jsonc": wrangler("DB") });

      expect(await init(cwd)).toEqual({
        code: 0,
        output: "active-record.jsonc names every database init finds; it wrote nothing",
      });
      expect(readFileSync(join(cwd, "active-record.jsonc"), "utf8")).toBe(text);
    });

    test("on Postgres, adds a Hyperdrive binding with its local connection string", async () => {
      const hyperdrive = [
        { binding: "HYPERDRIVE" },
        { binding: "LOGS", localConnectionString: "postgres://localhost/logs" },
      ];
      const cwd = project({
        "active-record.jsonc":
          '{ "databases": { "HYPERDRIVE": { "adapter": "postgresql", "url": "postgres://x/y" } } }',
        "wrangler.jsonc": JSON.stringify({ hyperdrive }),
      });

      expect(await init(cwd)).toEqual({
        code: 0,
        output: "Added LOGS to active-record.jsonc (on postgresql)",
      });
      expect(written(cwd)).toEqual({
        databases: {
          HYPERDRIVE: { adapter: "postgresql", url: "postgres://x/y" },
          LOGS: { adapter: "postgresql", url: "postgres://localhost/logs" },
        },
      });
    });

    test("--adapter naming another adapter than the file's adds nothing", async () => {
      const cwd = project({
        "active-record.jsonc": '{ "databases": { "DB": { "adapter": "d1" } } }',
        "wrangler.jsonc": JSON.stringify({ hyperdrive: [{ binding: "HYPERDRIVE" }] }),
      });

      expect(await init(cwd, { adapter: "postgresql" })).toEqual({
        code: 1,
        output:
          "active-record.jsonc names d1; a project uses one adapter, for now, so --adapter postgresql adds nothing",
      });
    });

    test("a file it can't read is left as it was, saying why", async () => {
      const cwd = project({
        "active-record.jsonc": "// mine\n{}",
        "wrangler.jsonc": wrangler("DB"),
      });

      expect(await init(cwd)).toEqual({ code: 1, output: "active-record.jsonc has no databases" });
      expect(readFileSync(join(cwd, "active-record.jsonc"), "utf8")).toBe("// mine\n{}");
    });
  });

  // A link where the file goes, even to nothing yet, is never written through.
  test("never writes through a link that's there, though it points at nothing", async () => {
    const cwd = project({
      "wrangler.jsonc": JSON.stringify({ d1_databases: [{ binding: "DB" }] }),
    });
    const target = join(cwd, "..", "elsewhere.jsonc");
    symlinkSync(target, join(cwd, "active-record.jsonc"));

    expect(await init(cwd)).toEqual({
      code: 1,
      output: "active-record.jsonc is a link; init writes nothing through it",
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
