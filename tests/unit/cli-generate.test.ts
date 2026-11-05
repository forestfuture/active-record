import { describe, expect, test } from "vite-plus/test";
import { parseColumns } from "../../packages/active-record/cli/generate/columns.ts";
import type { KeyType } from "../../packages/active-record/cli/adapter.ts";
import { migrationFor, migrationFileName } from "../../packages/d1-record/cli/migration.ts";
import { migrationNameError, modelName } from "../../packages/active-record/cli/generate/names.ts";
import {
  appendModel,
  modelFileName,
  modelSource,
} from "../../packages/active-record/cli/generate/model-file.ts";
import { schemaOf } from "../../packages/d1-record/cli/schema.ts";

/** Columns as parsed, or the errors joined, for short assertions. */
function columns(...args: string[]) {
  const result = parseColumns(args);
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return result.columns;
}

const noKeys = new Map<string, KeyType>();

/** The migration's SQL, or its error. */
function sqlFor(name: string, args: string[], options = {}, keys = noKeys) {
  const result = migrationFor(name, columns(...args), keys, options);
  return result.ok ? result.sql : result.error;
}

describe("the column syntax", () => {
  test("name:type, with string when the type is left out, and snake_case column names", () => {
    expect(columns("title", "priceCents:integer", "rating:real")).toEqual([
      { name: "title", type: "string", notNull: false, index: "none" },
      { name: "price_cents", type: "integer", notNull: false, index: "none" },
      { name: "rating", type: "real", notNull: false, index: "none" },
    ]);
  });

  test("! is NOT NULL, = a literal default, and :unique or :index an index", () => {
    expect(
      columns("email:string!:unique", "active:boolean!=false", "status=draft", "slug:index"),
    ).toEqual([
      { name: "email", type: "string", notNull: true, index: "unique" },
      { name: "active", type: "boolean", notNull: true, index: "none", default: false },
      { name: "status", type: "string", notNull: false, index: "none", default: "draft" },
      { name: "slug", type: "string", notNull: false, index: "index" },
    ]);
  });

  test("references name the table they point at, and are indexed", () => {
    expect(columns("user:references", "blogPost:references:unique")).toEqual([
      {
        name: "user_id",
        type: "references",
        notNull: true,
        index: "index",
        references: "users",
        association: "user",
      },
      {
        name: "blog_post_id",
        type: "references",
        notNull: true,
        index: "unique",
        references: "blog_posts",
        association: "blogPost",
      },
    ]);
  });

  test("a default may hold a colon; only :unique or :index at the end is an index", () => {
    expect(columns("starts:string=09:00", "tag:string=a:b:unique")).toEqual([
      { name: "starts", type: "string", notNull: false, index: "none", default: "09:00" },
      { name: "tag", type: "string", notNull: false, index: "unique", default: "a:b" },
    ]);
  });

  test("a mistyped column says what's allowed", () => {
    expect(
      parseColumns([
        "price:money",
        "count:integer=many",
        "at:datetime=now",
        "x:string:uniq",
        "9lives",
      ]),
    ).toEqual({
      ok: false,
      errors: [
        "price:money: money isn't a type; use string, integer, real, boolean, datetime, json or references",
        "count:integer=many: many isn't an integer",
        "at:datetime=now: only string, integer, real and boolean columns can have a default here",
        "x:string:uniq: write a column as name:type, with ! for NOT NULL, =value for a default, and :unique or :index",
        "9lives: write a column as name:type, with ! for NOT NULL, =value for a default, and :unique or :index",
      ],
    });
  });
});

describe("migrations: what the name says to do", () => {
  test("CreateProducts makes the table: a TEXT key generated in code, the columns, timestamps and indexes", () => {
    expect(sqlFor("CreateProducts", ["name:string!", "user:references", "sku:string:unique"])).toBe(
      `CREATE TABLE products (
  id TEXT PRIMARY KEY NOT NULL,
  name TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users (id),
  sku TEXT,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL
);
CREATE INDEX index_products_on_user_id ON products (user_id);
CREATE UNIQUE INDEX index_products_on_sku ON products (sku);
`,
    );
  });

  test("an integer key, no timestamps, json and defaults, and a reference's type from its table's key", () => {
    expect(
      sqlFor(
        "create_line_items",
        ["order:references", "settings:json", "quantity:integer!=1", "note=it's"],
        { integerId: true, timestamps: false },
        new Map<string, KeyType>([["orders", "INTEGER"]]),
      ),
    ).toBe(
      `CREATE TABLE line_items (
  id INTEGER PRIMARY KEY,
  order_id INTEGER NOT NULL REFERENCES orders (id),
  settings TEXT CHECK (json_valid(settings)),
  quantity INTEGER NOT NULL DEFAULT 1,
  note TEXT DEFAULT 'it''s'
);
CREATE INDEX index_line_items_on_order_id ON line_items (order_id);
`,
    );
  });

  test("names SQLite reserves are quoted", () => {
    expect(sqlFor("CreateOrders", ["order:integer", "group:string"])).toContain(
      '  "order" INTEGER,\n  "group" TEXT,',
    );
  });

  test("AddSkuToProducts adds columns, and a reference added later can be null, as in Rails", () => {
    expect(
      sqlFor("AddSkuToProducts", ["sku:string:unique", "active:boolean!=true", "user:references"]),
    ).toBe(
      `ALTER TABLE products ADD COLUMN sku TEXT;
ALTER TABLE products ADD COLUMN active BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE products ADD COLUMN user_id TEXT REFERENCES users (id);
CREATE UNIQUE INDEX index_products_on_sku ON products (sku);
CREATE INDEX index_products_on_user_id ON products (user_id);
`,
    );
  });

  test("adding a NOT NULL column without a default is refused, saying how to fix it", () => {
    expect(sqlFor("AddSkuToProducts", ["sku:string!"])).toBe(
      "products.sku: SQLite can't add a NOT NULL column without a default; give one (sku:string!=…) or leave out the !",
    );
  });

  test("RemoveSkuFromProducts drops the columns, and the indexes the generators made on them first", () => {
    expect(sqlFor("RemoveSkuFromProducts", ["sku", "code:index"])).toBe(
      `DROP INDEX IF EXISTS index_products_on_sku;
ALTER TABLE products DROP COLUMN sku;
DROP INDEX IF EXISTS index_products_on_code;
ALTER TABLE products DROP COLUMN code;
`,
    );
  });

  test("the table in a migration's name is made plural, as Rails makes it", () => {
    expect(sqlFor("CreateWidget", ["title"])).toMatch(/^CREATE TABLE widgets \(/);
    expect(sqlFor("AddSkuToProduct", ["sku"])).toBe("ALTER TABLE products ADD COLUMN sku TEXT;\n");
  });

  test("removing a reference drops its index, then its column, as for any column", () => {
    expect(sqlFor("RemoveUserFromOrders", ["user:references"])).toBe(
      "DROP INDEX IF EXISTS index_orders_on_user_id;\nALTER TABLE orders DROP COLUMN user_id;\n",
    );
  });

  test("any other name is an empty migration; Create, Add and Remove need their columns", () => {
    expect(sqlFor("BackfillPrices", [])).toBe("-- Write the migration's SQL here.\n");
    expect(sqlFor("AddSkuToProducts", [])).toBe(
      "AddSkuToProducts: name the columns to add (sku:string)",
    );
    expect(sqlFor("BackfillPrices", ["sku"])).toBe(
      "BackfillPrices: columns only go with Create…, Add…To… or Remove…From… migrations",
    );
  });

  test("the generated SQL reads back by the schema's conventions", () => {
    const sql = sqlFor("CreateProducts", [
      "name:string!",
      "active:boolean!=false",
      "settings:json",
      "price:real=1.5",
    ]);
    const result = schemaOf([{ name: "0001_create_products.sql", sql }]);

    expect(result.ok && result.tables[0]!.attributes).toEqual({
      id: { type: "string", null: false, generateId: true },
      name: { type: "string", null: false },
      active: { type: "boolean", null: false, default: { literal: false } },
      settings: { type: "json" },
      price: { type: "real", default: { literal: 1.5 } },
      createdAt: { type: "datetime", null: false },
      updatedAt: { type: "datetime", null: false },
    });
  });
});

describe("migration file names: numbered as Wrangler numbers them", () => {
  test("the next number after the highest, padded to four digits, then the name in snake_case", () => {
    expect(migrationFileName([], "CreateProducts")).toBe("0001_create_products.sql");
    expect(
      migrationFileName(["0001_init.sql", "0009_x.sql", "notes.md"], "add_sku_to_products"),
    ).toBe("0010_add_sku_to_products.sql");
    expect(migrationFileName(["0042_init/migration.sql"], "AddSKUToProducts")).toBe(
      "0043_add_sku_to_products.sql",
    );
  });
});

describe("Model files", () => {
  const model = {
    className: "LineItem",
    table: "line_items",
    associations: [{ name: "order", className: "Order" }],
    base: { className: "ApplicationRecord", importPath: "./application-record" },
  };

  test("one per Model, named in kebab-case, extending ApplicationRecord and importing its belongsTo targets", () => {
    expect(modelFileName("LineItem")).toBe("line-item.ts");
    expect(modelSource(model, { separateFiles: true }))
      .toBe(`import { belongsTo } from "@forestfuture/active-record";
import { ApplicationRecord } from "./application-record";
import { Order } from "./order";

export class LineItem extends ApplicationRecord {
  order = belongsTo(Order);
}
`);
    expect(modelSource({ ...model, associations: [] }, { separateFiles: true }))
      .toBe(`import { ApplicationRecord } from "./application-record";

export class LineItem extends ApplicationRecord {}
`);
  });

  // The base class's import path comes from the project's paths, so it's written escaped (#85).
  test("the base class's import path is an escaped string literal, and found again when appending", () => {
    const quoted = {
      ...model,
      associations: [],
      base: { className: "ApplicationRecord", importPath: './my"models\\record' },
    };
    const source = modelSource(quoted, { separateFiles: true });

    expect(source).toContain('import { ApplicationRecord } from "./my\\"models\\\\record";');
    expect(appendModel(source, { ...quoted, className: "Order", table: "orders" })).toEqual({
      ok: true,
      source: `${source}\nexport class Order extends ApplicationRecord {}\n`,
    });
  });

  test("appended to one models file, adding belongsTo to its import from the library", () => {
    const existing = `import { hasMany } from "@forestfuture/active-record";
import { ApplicationRecord } from "./models/application-record";

export class Order extends ApplicationRecord {
  lineItems = hasMany(LineItem);
}
`;
    const inOneFile = {
      ...model,
      base: { className: "ApplicationRecord", importPath: "./models/application-record" },
    };

    expect(appendModel(existing, inOneFile)).toEqual({
      ok: true,
      source: `import { belongsTo, hasMany } from "@forestfuture/active-record";
import { ApplicationRecord } from "./models/application-record";

export class Order extends ApplicationRecord {
  lineItems = hasMany(LineItem);
}

export class LineItem extends ApplicationRecord {
  order = belongsTo(Order);
}
`,
    });
    expect(appendModel("", inOneFile)).toEqual({
      ok: true,
      source: modelSource(inOneFile, { separateFiles: false }),
    });
  });

  test("a models file without the imports gets them, so Models of several databases can share one", () => {
    const logs = {
      ...model,
      base: { className: "LogsRecord", importPath: "./models/logs-record" },
    };
    const existing = `import { DbRecord } from "./models/db-record";

export class Order extends DbRecord {}
`;

    expect(appendModel(existing, logs)).toEqual({
      ok: true,
      source: `import { belongsTo } from "@forestfuture/active-record";
import { LogsRecord } from "./models/logs-record";
import { DbRecord } from "./models/db-record";

export class Order extends DbRecord {}

export class LineItem extends LogsRecord {
  order = belongsTo(Order);
}
`,
    });
    expect(appendModel('import { LogsRecord } from "./elsewhere";\n', logs)).toEqual({
      ok: false,
      error: "it imports LogsRecord from ./elsewhere, not ./models/logs-record",
    });
  });
});

describe("names", () => {
  test("a Model's name is made singular and a class, as Rails makes it, with a note when it was plural", () => {
    expect(modelName("LineItem")).toEqual({ ok: true, className: "LineItem" });
    expect(modelName("line_item")).toEqual({ ok: true, className: "LineItem" });
    expect(modelName("line_items")).toEqual({
      ok: true,
      className: "LineItem",
      note: "line_items looks plural, so the Model is LineItem, as Rails names it",
    });
    expect(modelName("People")).toMatchObject({ className: "Person" });
  });

  test("names that aren't letters, digits and _ are refused, so no file lands anywhere unexpected", () => {
    expect(modelName("foo-bar")).toEqual({
      ok: false,
      error: "foo-bar isn't a Model name; use letters and digits, like LineItem",
    });
    expect(migrationNameError("../../evil")).toBe(
      "../../evil isn't a migration name; use letters, digits and _, like AddSkuToProducts",
    );
    expect(migrationNameError("Add Thing")).toBeDefined();
    expect(migrationNameError("add_sku_to_products")).toBeUndefined();
  });
});
