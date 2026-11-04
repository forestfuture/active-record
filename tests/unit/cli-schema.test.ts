import { describe, expect, test } from "vite-plus/test";
import { fingerprintOf } from "../../packages/d1-record/cli/schema/render.ts";
import { schemaOf } from "../../packages/d1-record/cli/schema/schema.ts";

/** The tables a set of migrations makes, as the schema command reads them. */
function tables(...sql: string[]) {
  const result = schemaOf(sql.map((text, index) => ({ name: `000${index + 1}_m.sql`, sql: text })));
  if (!result.ok) throw new Error(result.errors.join("\n"));
  return result;
}

function attributes(sql: string) {
  return tables(sql).tables[0]!.attributes;
}

describe("schemaOf: from migrations to table schemas", () => {
  test("declared types decide each attribute's type", () => {
    expect(
      attributes(`CREATE TABLE things (
        id INTEGER PRIMARY KEY, a INTEGER, b INT, c BIGINT, d TEXT, e VARCHAR(40), f CHAR(2),
        g REAL, h FLOAT, i DOUBLE, j BOOLEAN, k DATETIME, l TIMESTAMP, m DATE, n JSON
      )`),
    ).toMatchObject({
      a: { type: "integer" },
      b: { type: "integer" },
      c: { type: "integer" },
      d: { type: "string" },
      e: { type: "string" },
      f: { type: "string" },
      g: { type: "real" },
      h: { type: "real" },
      i: { type: "real" },
      j: { type: "boolean" },
      k: { type: "datetime" },
      l: { type: "datetime" },
      m: { type: "datetime" },
      n: { type: "json" },
    });
  });

  test("a TEXT column checked with json_valid is json, as D1 stores JSON in TEXT", () => {
    expect(
      attributes(`CREATE TABLE things (
        id INTEGER PRIMARY KEY,
        settings TEXT CHECK (json_valid(settings)),
        meta TEXT,
        CHECK (json_valid("meta"))
      )`),
    ).toMatchObject({ settings: { type: "json" }, meta: { type: "json" } });
  });

  test("names refine only a plain TEXT or INTEGER: …_at is a datetime in TEXT, is_/has_ a boolean in INTEGER", () => {
    const result = tables(`CREATE TABLE things (
      id INTEGER PRIMARY KEY, published_at TEXT, synced_at INTEGER, is_active INTEGER,
      has_children INTEGER, archived_at DATETIME, is_label TEXT
    )`);

    expect(result.tables[0]!.attributes).toMatchObject({
      publishedAt: { type: "datetime" },
      syncedAt: { type: "integer" },
      isActive: { type: "boolean" },
      hasChildren: { type: "boolean" },
      archivedAt: { type: "datetime" },
      isLabel: { type: "string" },
    });
    expect(result.notes).toEqual([
      "things.is_active: INTEGER read as boolean, from its is_ name",
      "things.has_children: INTEGER read as boolean, from its has_ name",
    ]);
  });

  test("a datetime column with a number or an epoch function as its default is noted, naming storage (#73)", () => {
    const result = tables(`CREATE TABLE things (
      id INTEGER PRIMARY KEY,
      a DATETIME DEFAULT 0,
      b TIMESTAMP DEFAULT (unixepoch()),
      c DATETIME DEFAULT (cast(unixepoch('subsecond') * 1000 as integer)),
      d DATETIME DEFAULT CURRENT_TIMESTAMP,
      e DATETIME DEFAULT '2026-01-02T03:04:05Z'
    )`);
    const override =
      'override it in its Model as { type: "datetime", storage: "unixSeconds" or "unixMilliseconds" }';

    expect(result.notes).toEqual([
      `things.a: a datetime with a number as its default; if it holds a Unix time, ${override}`,
      `things.b: a datetime with a number as its default; if it holds a Unix time, ${override}`,
      `things.c: a datetime with a number as its default; if it holds a Unix time, ${override}`,
    ]);
  });

  test("a datetime whose default is SQLite's own date text is listed beside the tables (#143)", () => {
    const result = tables(`CREATE TABLE things (
      id INTEGER PRIMARY KEY,
      a DATETIME DEFAULT CURRENT_TIMESTAMP,
      b TIMESTAMP DEFAULT (datetime('now')),
      c DATETIME DEFAULT '2026-01-02T03:04:05Z',
      d DATETIME,
      e TEXT DEFAULT CURRENT_TIMESTAMP,
      f_at TEXT DEFAULT CURRENT_TIMESTAMP
    )`);

    // f_at is a datetime by its name, so it counts; e is plain text, so it doesn't.
    expect(result.textDates).toEqual(["things.a", "things.b", "things.f_at"]);
  });

  test("listing them leaves the tables and the schema's fingerprint as they were (#143)", () => {
    const plain = tables(`CREATE TABLE things (id INTEGER PRIMARY KEY, a DATETIME)`);
    const defaulted = tables(
      `CREATE TABLE things (id INTEGER PRIMARY KEY, a DATETIME DEFAULT CURRENT_TIMESTAMP)`,
    );

    expect(defaulted.tables).toEqual(plain.tables);
    const schema = (tables: typeof plain.tables) => ({ tables, binding: "DB", models: [] });
    expect(fingerprintOf(schema(defaulted.tables))).toBe(fingerprintOf(schema(plain.tables)));
  });

  test("NOT NULL columns and the primary key are null: false", () => {
    expect(
      attributes("CREATE TABLE things (id INTEGER PRIMARY KEY, a TEXT NOT NULL, b TEXT)"),
    ).toEqual({
      id: { type: "integer", null: false },
      a: { type: "string", null: false },
      b: { type: "string" },
    });
  });

  test("a TEXT primary key is generated in code; an INTEGER one is left to D1", () => {
    expect(attributes("CREATE TABLE things (id TEXT PRIMARY KEY)").id).toEqual({
      type: "string",
      null: false,
      generateId: true,
    });
    expect(attributes("CREATE TABLE things (id INTEGER PRIMARY KEY)").id).toEqual({
      type: "integer",
      null: false,
    });
  });

  test("the primary key needn't be called id", () => {
    const [table] = tables("CREATE TABLE things (code TEXT PRIMARY KEY, name TEXT)").tables;

    expect(table!.primaryKey).toBe("code");
  });

  test("simple literal defaults are copied, so new records show them; expressions stay with D1", () => {
    expect(
      attributes(`CREATE TABLE things (
        id INTEGER PRIMARY KEY, a INTEGER DEFAULT 3, b REAL DEFAULT -1.5, c TEXT DEFAULT 'it''s',
        d BOOLEAN DEFAULT TRUE, e BOOLEAN NOT NULL DEFAULT 0, f TEXT DEFAULT CURRENT_TIMESTAMP,
        g INTEGER DEFAULT (1 + 1), h TEXT DEFAULT NULL
      )`),
    ).toMatchObject({
      a: { default: { literal: 3 } },
      b: { default: { literal: -1.5 } },
      c: { default: { literal: "it's" } },
      d: { default: { literal: true } },
      e: { default: { literal: false } },
      f: { type: "string" },
      g: { type: "integer" },
      h: { type: "string" },
    });
    const plain = attributes(
      "CREATE TABLE things (id INTEGER PRIMARY KEY, f TEXT DEFAULT CURRENT_TIMESTAMP)",
    );
    expect(plain.f).not.toHaveProperty("default");
  });

  test("attributes are camelCase; a column whose name doesn't round-trip keeps it", () => {
    expect(
      attributes("CREATE TABLE things (id INTEGER PRIMARY KEY, price_cents INTEGER, htmlURL TEXT)"),
    ).toEqual({
      id: { type: "integer", null: false },
      priceCents: { type: "integer" },
      htmlURL: { type: "string", column: "htmlURL" },
    });
  });

  test("a foreign key without a declared type takes the referenced column's type", () => {
    const result = tables(
      "CREATE TABLE users (id TEXT PRIMARY KEY)",
      "CREATE TABLE posts (id INTEGER PRIMARY KEY, user_id REFERENCES users (id) NOT NULL)",
    );

    expect(result.tables.find((table) => table.name === "posts")!.attributes.userId).toEqual({
      type: "string",
      null: false,
    });
  });

  test("each table records the migration that last changed it, and later migrations apply", () => {
    const result = tables(
      "CREATE TABLE users (id INTEGER PRIMARY KEY)",
      "CREATE TABLE posts (id INTEGER PRIMARY KEY)",
      "ALTER TABLE users ADD COLUMN bio TEXT",
    );

    expect(result.tables.map((table) => [table.name, table.lastChangedBy])).toEqual([
      ["posts", "0002_m.sql"],
      ["users", "0003_m.sql"],
    ]);
    expect(result.tables[1]!.attributes).toHaveProperty("bio");
  });

  test("SQLite's, Cloudflare's and the migrations' own tables, and views, are left out", () => {
    const result = schemaOf(
      [
        {
          name: "0001_m.sql",
          sql: `CREATE TABLE things (id INTEGER PRIMARY KEY);
            CREATE TABLE d1_migrations (id INTEGER PRIMARY KEY, name TEXT);
            CREATE TABLE _cf_kv (key TEXT PRIMARY KEY);
            CREATE TABLE seen (id INTEGER PRIMARY KEY);
            CREATE VIEW recent AS SELECT * FROM things;`,
        },
      ],
      { migrationsTable: "seen" },
    );

    expect(result.ok && result.tables.map((table) => table.name)).toEqual([
      "d1_migrations",
      "things",
    ]);
  });

  test("columns the library can't hold, and composite keys, are errors that say what to do", () => {
    const result = schemaOf([
      {
        name: "0001_m.sql",
        sql: `CREATE TABLE things (id INTEGER PRIMARY KEY, price NUMERIC, photo BLOB);
          CREATE TABLE pairs (a INTEGER, b INTEGER, PRIMARY KEY (a, b));`,
      },
    ]);

    expect(result).toEqual({
      ok: false,
      errors: [
        "pairs: a composite primary key (a, b) isn't supported; give the table a single key",
        "things.price: NUMERIC loses precision as a number; store money as integer cents (price_cents INTEGER)",
        "things.photo: BLOB columns aren't supported yet (#20)",
      ],
    });
  });

  test("a migration that fails names its file and SQLite's message", () => {
    const result = schemaOf([
      { name: "0001_ok.sql", sql: "CREATE TABLE things (id INTEGER PRIMARY KEY)" },
      { name: "0002_typo.sql", sql: "ALTER TABLE thing ADD COLUMN x TEXT" },
    ]);

    expect(result).toEqual({
      ok: false,
      errors: [expect.stringMatching(/^0002_typo\.sql: .*no such table: thing/)],
    });
  });

  test("virtual tables, and the shadow tables SQLite keeps for them, are left out", () => {
    const result = tables(
      "CREATE TABLE notes (id INTEGER PRIMARY KEY, body TEXT)",
      "CREATE VIRTUAL TABLE notes_search USING fts5(body)",
    );

    expect(result.tables.map((table) => table.name)).toEqual(["notes"]);
  });

  test("a foreign key that names no column takes the parent's primary key's type", () => {
    const result = tables(
      "CREATE TABLE orgs (oid INTEGER PRIMARY KEY)",
      "CREATE TABLE teams (id INTEGER PRIMARY KEY, org_id REFERENCES orgs)",
    );

    expect(result.tables.find((table) => table.name === "teams")!.attributes.orgId).toEqual({
      type: "integer",
    });
  });

  test("names refine only a column declared exactly TEXT or INTEGER", () => {
    const result = tables(`CREATE TABLE things (
      id INTEGER PRIMARY KEY, has_x BIGINT, seen_at VARCHAR(20), done_at, payload_at TEXT CHECK (json_valid(payload_at))
    )`);

    expect(result.tables[0]!.attributes).toMatchObject({
      hasX: { type: "integer" },
      seenAt: { type: "string" },
      doneAt: { type: "string" },
      payloadAt: { type: "json" },
    });
    expect(result.notes).toEqual([expect.stringContaining("things.done_at: has no declared type")]);
  });

  test("a column with no declared type, or one SQLite gives no affinity, is noted as a string (#159)", () => {
    const result = tables(`CREATE TABLE things (
      id INTEGER PRIMARY KEY, a, b UUID, c TEXT, d ANY, e BLOB_ISH, f TEXT CHECK (json_valid(f))
    )`);

    expect(result.notes).toEqual([
      "things.a: has no declared type, so it's read as a string; a number in it fails when the record loads, so override it in its Model with the type it holds",
      "things.b: is declared UUID, so it's read as a string; a number in it fails when the record loads, so override it in its Model with the type it holds",
      "things.d: is declared ANY, so it's read as a string; a number in it fails when the record loads, so override it in its Model with the type it holds",
      "things.e: is declared BLOB_ISH, so it's read as a string; a number in it fails when the record loads, so override it in its Model with the type it holds",
    ]);
  });

  test("a primary key's own literal default wins over a key generated in code", () => {
    expect(attributes("CREATE TABLE things (code TEXT PRIMARY KEY DEFAULT 'main')").code).toEqual({
      type: "string",
      null: false,
      default: { literal: "main" },
    });
  });

  test("defaults are copied for json and datetime columns, and large integers are left to D1", () => {
    expect(
      attributes(`CREATE TABLE things (
        id INTEGER PRIMARY KEY,
        settings TEXT DEFAULT '{"a":[1]}' CHECK (json_valid(settings)),
        tags JSON DEFAULT '[]',
        starts_at DATETIME DEFAULT '2026-01-01T00:00:00.000Z',
        big INTEGER DEFAULT 99999999999999999999,
        flag INTEGER DEFAULT TRUE
      )`),
    ).toMatchObject({
      settings: { default: { literal: { a: [1] } } },
      tags: { default: { literal: [] } },
      startsAt: { default: { date: "2026-01-01T00:00:00.000Z" } },
      big: { type: "integer" },
      flag: { default: { literal: 1 } },
    });
    expect(
      attributes(
        "CREATE TABLE things (id INTEGER PRIMARY KEY, big INTEGER DEFAULT 99999999999999999999)",
      ).big,
    ).not.toHaveProperty("default");
  });

  test("a leading underscore stays, and json_valid finds quoted names", () => {
    expect(
      attributes(`CREATE TABLE things (
        id INTEGER PRIMARY KEY, _secret TEXT, "my col" TEXT CHECK (json_valid("my col"))
      )`),
    ).toMatchObject({ _secret: { type: "string" }, "my col": { type: "json" } });
  });

  test("tables are in plain character order, whatever the machine's locale", () => {
    expect(
      tables(
        "CREATE TABLE a (id INTEGER PRIMARY KEY)",
        "CREATE TABLE B (id INTEGER PRIMARY KEY)",
        "CREATE TABLE _z (id INTEGER PRIMARY KEY)",
      ).tables.map((table) => table.name),
    ).toEqual(["B", "_z", "a"]);
  });

  test("a table with no primary key, and names that would collide, are errors that say what to do", () => {
    const result = schemaOf([
      {
        name: "0001_m.sql",
        sql: `CREATE TABLE logs (message TEXT);
          CREATE TABLE things (id INTEGER PRIMARY KEY, user_id INTEGER, userId INTEGER);
          CREATE TABLE line_items (id INTEGER PRIMARY KEY);
          CREATE TABLE "line-items" (id INTEGER PRIMARY KEY);`,
      },
    ]);

    expect(result).toEqual({
      ok: false,
      errors: [
        "line-items and line_items would both be exported as lineItems; rename one of the tables",
        "logs: no primary key; d1-record needs one (id INTEGER PRIMARY KEY, or id TEXT PRIMARY KEY)",
        "things: columns user_id and userId would both be the attribute userId; rename one",
      ],
    });
  });
});
