import { readdirSync, readFileSync } from "node:fs";
import { describe, expect, test } from "vite-plus/test";
import {
  pgDriver,
  pgliteModule,
} from "../../packages/active-record/cli/adapters/postgresql/drivers.ts";

/** Node's error for a package that isn't installed: `require`'s, or `import`'s. */
const missing = (name: string, code = "MODULE_NOT_FOUND") =>
  Object.assign(new Error(`Cannot find module '${name}' imported from /app/x.mjs`), { code });

// pg and PGlite are the app's, optional peer dependencies: the command says what to install (#301).
describe("the PostgreSQL adapter's drivers", () => {
  test("pg is the one installed beside the library", () => {
    const pg = pgDriver();

    expect(typeof pg === "string" ? pg : typeof pg.Pool).toBe("function");
  });

  test("without pg, says to install it", () => {
    expect(
      pgDriver(() => {
        throw missing("pg");
      }),
    ).toBe("The PostgreSQL adapter needs pg, which isn't installed here: run `npm install pg`");
  });

  test("a pg that fails for another reason, such as a package it needs, throws that", () => {
    const broken = () => {
      throw missing("pg-pool");
    };

    expect(() => pgDriver(broken)).toThrow("Cannot find module 'pg-pool'");
  });

  test("PGlite is the one installed beside the library", async () => {
    const pglite = await pgliteModule();

    expect(typeof pglite === "string" ? pglite : typeof pglite.PGlite).toBe("function");
  });

  test("without PGlite, says to install it, to read a schema", async () => {
    const absent = () => Promise.reject(missing("@electric-sql/pglite", "ERR_MODULE_NOT_FOUND"));

    expect(await pgliteModule(absent)).toBe(
      "Reading a PostgreSQL schema needs PGlite, which isn't installed here: run `npm install --save-dev @electric-sql/pglite`",
    );
  });

  // The command loads the plugin for every PostgreSQL project, so the plugin loads without them.
  test("only drivers.ts loads them: the plugin's other modules import their types alone", () => {
    const folder = new URL(
      "../../packages/active-record/cli/adapters/postgresql/",
      import.meta.url,
    );
    const loading = readdirSync(folder)
      .filter((file) => file.endsWith(".ts") && file !== "drivers.ts")
      .filter((file) =>
        /^import (?!type )[^;]*from "(pg|@electric-sql\/pglite[^"]*)";/m.test(
          readFileSync(new URL(file, folder), "utf8"),
        ),
      );

    expect(loading).toEqual([]);
  });
});
