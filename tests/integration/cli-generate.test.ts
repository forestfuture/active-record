import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { join } from "node:path";
import { Miniflare } from "miniflare";
import { afterAll, describe, expect, test } from "vite-plus/test";
import { runGenerate } from "../../packages/active-record/cli/generate/command.ts";
import { connect } from "../../packages/d1-record/src/index.ts";

// Inside tests/ (gitignored), so a generated project's imports of the library resolve as they
// do in the repo, through tsconfig.json's paths.
const scratch = new URL("../.scratch/", import.meta.url).pathname;
const made: string[] = [];
afterAll(() => {
  for (const dir of made) rmSync(dir, { recursive: true, force: true });
});

/** A throwaway project with a Wrangler config: its files, by path. */
function project(files: Record<string, string> = {}): string {
  mkdirSync(scratch, { recursive: true });
  const dir = mkdtempSync(join(scratch, "generate-"));
  made.push(dir);
  const all = {
    "wrangler.jsonc": '{ "d1_databases": [{ "binding": "DB", "database_name": "shop-db" }] }',
    ...files,
  };
  for (const [path, content] of Object.entries(all)) {
    mkdirSync(join(dir, path, ".."), { recursive: true });
    writeFileSync(join(dir, path), content);
  }
  return dir;
}

/** Runs a generator (`g model …` or `g migration …`), collecting what it prints. */
async function generate(
  cwd: string,
  args: string[],
  options: Partial<Parameters<typeof runGenerate>[0]> = {},
) {
  const [kind, name, ...columns] = args as ["model" | "migration", string, ...string[]];
  const output: string[] = [];
  const code = await runGenerate({ cwd, kind, name, columns, ...options }, (line) =>
    output.push(line),
  );
  return { code, output: output.join("\n") };
}

/** A generated Model file's classes, loaded as an app would import them (typed loosely). */
async function modelsIn(cwd: string, path: string) {
  const models: Record<string, any> = await import(join(cwd, path));
  return models;
}

const read = (cwd: string, path: string) => readFileSync(join(cwd, path), "utf8");

describe("active-record g model", () => {
  test("refuses to write one file twice, such as a schema --out naming the new Model", async () => {
    const cwd = project({ "migrations/.keep": "" });

    const { code, output } = await generate(cwd, ["model", "Product"], {
      out: "src/models/product.ts",
    });

    expect(code).toBe(1);
    expect(output).toBe(
      "src/models/product.ts would be written twice; choose another --out or name\nWrote nothing",
    );
    expect(existsSync(join(cwd, "src/models/product.ts"))).toBe(false);
    expect(readdirSync(join(cwd, "migrations"))).toEqual([".keep"]);
  });

  test("writes a migration and a Model, regenerates the schema, and says what's next", async () => {
    const cwd = project();

    const { code, output } = await generate(cwd, [
      "model",
      "Product",
      "name:string!",
      "priceCents:integer!=0",
    ]);

    expect(code).toBe(0);
    expect(output).toBe(`Wrote migrations/0001_create_products.sql
Wrote src/models/product.ts
Wrote src/db/schema.ts (1 table) from migrations/
Wrote src/models/application-record.ts
Next: npx active-record migrate`);
    expect(read(cwd, "src/models/product.ts"))
      .toBe(`import { ApplicationRecord } from "./application-record";

export class Product extends ApplicationRecord {}
`);
    expect(read(cwd, "src/db/schema.ts")).toContain(
      '  priceCents: { type: "integer", null: false, default: () => 0 },',
    );
  });

  test("the generated application-record.ts shows how to hide attributes from toJSON", async () => {
    const cwd = project();
    await generate(cwd, ["model", "User", "email:string!"]);

    expect(read(cwd, "src/models/application-record.ts")).toContain(
      '// static override hiddenAttributes = ["passwordDigest"];',
    );
  });

  test("a reference takes its table's key type, and its belongsTo imports the target's file", async () => {
    const cwd = project();
    await generate(cwd, ["model", "Order", "total:integer"], { integerId: true });

    const { code } = await generate(cwd, [
      "model",
      "LineItem",
      "order:references",
      "quantity:integer!=1",
    ]);

    expect(code).toBe(0);
    expect(read(cwd, "migrations/0002_create_line_items.sql")).toContain(
      "order_id INTEGER NOT NULL REFERENCES orders (id)",
    );
    expect(read(cwd, "src/models/line-item.ts"))
      .toBe(`import { belongsTo } from "@forestfuture/active-record";
import { ApplicationRecord } from "./application-record";
import { Order } from "./order";

export class LineItem extends ApplicationRecord {
  order = belongsTo(Order);
}
`);
  });

  test("--models puts Models and ApplicationRecord in another folder, for both commands", async () => {
    const cwd = project();

    const model = await generate(cwd, ["model", "Product"], { models: "src/app/models" });

    expect(model.output).toBe(`Wrote migrations/0001_create_products.sql
Wrote src/app/models/product.ts
Wrote src/db/schema.ts (1 table) from migrations/
Wrote src/app/models/application-record.ts
Next: npx active-record migrate`);
    expect(read(cwd, "src/app/models/product.ts")).toContain(
      'import { ApplicationRecord } from "./application-record";',
    );
    expect(read(cwd, "src/app/models/application-record.ts")).toContain(
      'import { schema } from "../../db/schema";',
    );
    expect(existsSync(join(cwd, "src/models"))).toBe(false);
  });

  test("refuses before writing anything when the schema can't be written (a Drizzle schema folder)", async () => {
    const cwd = project({ "src/db/schema/index.ts": "export {};" });

    const { code, output } = await generate(cwd, ["model", "Product"]);

    expect(code).toBe(1);
    expect(output).toMatch(
      /^src\/db\/schema\.ts would take over imports of the folder src\/db\/schema\/.*\nWrote nothing$/,
    );
    expect(existsSync(join(cwd, "migrations"))).toBe(false);
    expect(existsSync(join(cwd, "src/models"))).toBe(false);
  });

  test("--out regenerates another schema file, as in a Drizzle project with its own src/db/schema/", async () => {
    const cwd = project({ "src/db/schema/index.ts": "export {};" });

    const { code, output } = await generate(cwd, ["model", "Product"], {
      out: "src/db/d1-record.ts",
    });

    expect(code).toBe(0);
    expect(output).toContain("Wrote src/db/d1-record.ts (1 table) from migrations/");
    expect(read(cwd, "src/models/application-record.ts")).toContain('from "../db/d1-record";');
  });

  test("--models appends to one file", async () => {
    const cwd = project();
    await generate(cwd, ["model", "User", "email:string!:unique"], { models: "src/models.ts" });

    await generate(cwd, ["model", "Post", "user:references"], { models: "src/models.ts" });

    expect(read(cwd, "src/models.ts"))
      .toBe(`import { belongsTo } from "@forestfuture/active-record";
import { ApplicationRecord } from "./application-record";

export class User extends ApplicationRecord {}

export class Post extends ApplicationRecord {
  user = belongsTo(User);
}
`);
  });

  test("refuses, writing nothing, when the table or the Model file already exists", async () => {
    const cwd = project();
    await generate(cwd, ["model", "Product"]);

    expect(await generate(cwd, ["model", "Product"])).toEqual({
      code: 1,
      output: "src/models/product.ts already exists\nWrote nothing",
    });
    expect(await generate(cwd, ["model", "Product"], { models: "src/other" })).toEqual({
      code: 1,
      output: expect.stringMatching(
        /^0002_create_products\.sql: .*table products already exists\nWrote nothing$/,
      ),
    });
    expect(readdirSync(join(cwd, "migrations"))).toEqual(["0001_create_products.sql"]);
  });
});

describe("names", () => {
  test("a plural Model name is made singular, with a note, as Rails does", async () => {
    const cwd = project();

    const { code, output } = await generate(cwd, ["model", "line_items"]);

    expect(code).toBe(0);
    expect(output).toContain("Wrote src/models/line-item.ts");
    expect(output).toContain(
      "Note: line_items looks plural, so the Model is LineItem, as Rails names it",
    );
    expect(read(cwd, "src/models/line-item.ts")).toContain(
      "export class LineItem extends ApplicationRecord {}",
    );
  });

  test("a name that isn't letters, digits and _ is refused, and nothing is written", async () => {
    const cwd = project();

    expect(await generate(cwd, ["migration", "../../evil"])).toEqual({
      code: 1,
      output:
        "../../evil isn't a migration name; use letters, digits and _, like AddSkuToProducts\nWrote nothing",
    });
    expect(await generate(cwd, ["model", "foo-bar"])).toEqual({
      code: 1,
      output: "foo-bar isn't a Model name; use letters and digits, like LineItem\nWrote nothing",
    });
    expect(readdirSync(cwd)).toEqual(["wrangler.jsonc"]);
  });
});

describe("active-record g migration", () => {
  test("adds and removes columns, numbering after the existing migrations", async () => {
    const cwd = project({
      "migrations/0007_create_products.sql": "CREATE TABLE products (id TEXT PRIMARY KEY);",
    });

    const added = await generate(cwd, [
      "migration",
      "AddSkuToProducts",
      "sku:string:unique",
      "active:boolean!=true",
    ]);
    const removed = await generate(cwd, ["migration", "RemoveSkuFromProducts", "sku"]);

    expect(added.code).toBe(0);
    expect(added.output).toMatch(/^Wrote migrations\/0008_add_sku_to_products\.sql\n/);
    expect(removed.code).toBe(0);
    expect(read(cwd, "src/db/schema.ts")).toContain(
      "/** products — last changed by 0009_remove_sku_from_products.sql */",
    );
    expect(read(cwd, "src/db/schema.ts")).not.toContain("sku:");
  });

  test("an empty migration for any other name; a NOT NULL column without a default is refused", async () => {
    const cwd = project({
      "migrations/0001_create_products.sql": "CREATE TABLE products (id TEXT PRIMARY KEY);",
    });

    expect((await generate(cwd, ["migration", "BackfillPrices"])).code).toBe(0);
    expect(read(cwd, "migrations/0002_backfill_prices.sql")).toBe(
      "-- Write the migration's SQL here.\n",
    );
    expect(await generate(cwd, ["migration", "AddSkuToProducts", "sku:string!"])).toEqual({
      code: 1,
      output:
        "products.sku: SQLite can't add a NOT NULL column without a default; give one (sku:string!=…) or leave out the !\nWrote nothing",
    });
  });

  test("several databases need --database, and a migrations_pattern the file wouldn't match is refused", async () => {
    const two = project({
      "wrangler.jsonc":
        '{ "d1_databases": [{ "binding": "DB" }, { "binding": "LOGS", "migrations_dir": "logs" }] }',
    });
    const drizzle = project({
      "wrangler.jsonc":
        '{ "d1_databases": [{ "binding": "DB", "migrations_pattern": "migrations/*/migration.sql" }] }',
    });

    expect(await generate(two, ["model", "Product"])).toEqual({
      code: 1,
      output: "This config has several databases; choose one with --database (DB or LOGS)",
    });
    expect((await generate(two, ["model", "Entry"], { database: "LOGS" })).output).toContain(
      "Wrote logs/0001_create_entries.sql\nWrote src/models/entry.ts\nWrote src/db/LOGS.ts",
    );
    expect(await generate(drizzle, ["model", "Product"])).toEqual({
      code: 1,
      output:
        "migrations/0001_create_products.sql wouldn't match migrations_pattern (migrations/*/migration.sql) in wrangler.jsonc, so it wouldn't be applied; write the migration with your migration tool instead",
    });
    expect(existsSync(join(drizzle, "migrations"))).toBe(false);
  });
});

// Each test starts Miniflare, which takes longer than the default 5 s on a loaded machine (#182).
describe("generated files against D1", { timeout: 30_000 }, () => {
  let mf: Miniflare | undefined;
  afterAll(() => mf?.dispose());

  test("the migrations apply to D1, and the Models create and find records through them", async () => {
    const cwd = project();
    await generate(cwd, ["model", "User", "email:string!:unique", "admin:boolean!=false"]);
    await generate(cwd, ["model", "Post", "user:references", "title:string!", "meta:json"]);
    await generate(cwd, ["migration", "AddViewsToPosts", "views:integer!=0:index"]);
    mf = new Miniflare({ modules: true, script: "export default {}", d1Databases: ["DB"] });
    const binding = await mf.getD1Database("DB");
    for (const file of readdirSync(join(cwd, "migrations")).sort()) {
      await binding.exec(read(cwd, `migrations/${file}`).replaceAll("\n", " "));
    }
    const { User } = await modelsIn(cwd, "src/models/user.ts");
    const { Post } = await modelsIn(cwd, "src/models/post.ts");
    const db = connect(binding);

    const user = await db.model(User).createOrThrow({ email: "ada@example.com" });
    const post = await db
      .model(Post)
      .createOrThrow({ userId: user.id, title: "Hello", meta: { tags: ["a"] } });
    const found = await db.model(Post).find(post.id);

    expect([user.admin, found.views, found.meta, (await found.user())?.email]).toEqual([
      false,
      0,
      { tags: ["a"] },
      "ada@example.com",
    ]);
  });

  test("a generated reference can be removed again, and the migrations still apply to D1", async () => {
    const cwd = project();
    await generate(cwd, ["model", "User"]);
    await generate(cwd, ["model", "Post", "user:references", "title"]);
    const removed = await generate(cwd, ["migration", "RemoveUserFromPosts", "user:references"]);
    const local = new Miniflare({
      modules: true,
      script: "export default {}",
      d1Databases: ["DB"],
    });
    const binding = await local.getD1Database("DB");

    try {
      for (const file of readdirSync(join(cwd, "migrations")).sort()) {
        await binding.exec(read(cwd, `migrations/${file}`).replaceAll("\n", " "));
      }
      expect(removed.code).toBe(0);
      expect(read(cwd, "src/db/schema.ts")).not.toContain("userId");
    } finally {
      await local.dispose();
    }
  });
});
