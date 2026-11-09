import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { runGenerate } from "../../../packages/active-record/cli/generate/command.ts";
import { writePgProject } from "../../support/pg-project.ts";
import { scratchDirs } from "../../support/scratch.ts";

// PGlite starts for each schema read, which takes seconds with coverage on.
const pgliteTimeout = { timeout: 60_000 };

const scratch = scratchDirs();

// Migrations are named for the UTC second they're written in, so the clock is set.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-11-08T09:05:03Z"));
});
afterEach(() => {
  vi.useRealTimers();
});

/** Runs a generator (`g model …` or `g migration …`), collecting what it prints. */
async function generate(cwd: string, args: string[], options: { integerId?: boolean } = {}) {
  const [kind, name, ...columns] = args as ["model" | "migration", string, ...string[]];
  const output: string[] = [];
  const code = await runGenerate({ cwd, kind, name, columns, ...options }, (line) =>
    output.push(line),
  );
  return { code, output: output.join("\n") };
}

const read = (cwd: string, path: string) => readFileSync(join(cwd, path), "utf8");

// `g model` and `g migration` on a Postgres project (#285).
describe("the generators, on Postgres", pgliteTimeout, () => {
  test("g model writes Postgres's migration, its Model and the schema", async () => {
    const cwd = writePgProject(scratch("pg-generate-", true), { HYPERDRIVE: {} });

    const { code, output } = await generate(cwd, ["model", "Product", "name:string!"]);

    expect([code, output]).toEqual([
      0,
      [
        "Wrote migrations/20261108090503_create_products.sql",
        "Wrote src/models/product.ts",
        "Wrote src/db/schema.ts (1 table) from migrations/",
        "Wrote src/models/application-record.ts",
        "Next: npx active-record migrate",
      ].join("\n"),
    ]);
    expect(read(cwd, "migrations/20261108090503_create_products.sql")).toMatch(
      /^CREATE TABLE products \(\n {2}id UUID PRIMARY KEY,\n {2}name TEXT NOT NULL,/,
    );
    expect(read(cwd, "src/db/schema.ts")).toContain(
      'id: { type: "string", null: false, generateId: true },',
    );
  });

  test("a reference takes its table's key type, as Postgres declares it", async () => {
    const cwd = writePgProject(scratch("pg-generate-", true), { HYPERDRIVE: {} });
    await generate(cwd, ["model", "Order", "total:integer"], { integerId: true });
    await generate(cwd, ["model", "Customer"]);

    const { code, output } = await generate(cwd, [
      "model",
      "LineItem",
      "order:references",
      "customer:references",
    ]);

    expect([code, output.split("\n")[0]]).toEqual([
      0,
      "Wrote migrations/20261108090505_create_line_items.sql",
    ]);
    expect(read(cwd, "migrations/20261108090505_create_line_items.sql")).toContain(
      "  order_id BIGINT NOT NULL REFERENCES orders (id),\n  customer_id UUID NOT NULL REFERENCES customers (id),\n",
    );
  });

  test("a migration Postgres refuses after the others is refused, and nothing is written", async () => {
    const cwd = writePgProject(
      scratch("pg-generate-", true),
      { HYPERDRIVE: {} },
      {
        "migrations/1_create_products.sql":
          "CREATE TABLE products (id UUID PRIMARY KEY, sku TEXT);",
      },
    );

    const { code, output } = await generate(cwd, ["migration", "AddSkuToProducts", "sku"]);

    expect(code).toBe(1);
    expect(output).toMatch(
      /^20261108090503_add_sku_to_products\.sql: column "sku" of relation "products" already exists\nWrote nothing$/,
    );
    expect(readdirSync(join(cwd, "migrations"))).toEqual(["1_create_products.sql"]);
  });
});
