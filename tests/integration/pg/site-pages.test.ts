import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { withDatabase } from "../../../packages/active-record/src/index.ts";
import { connect } from "../../../packages/active-record/src/adapters/postgresql/index.ts";
import * as batchIteration from "../../../site/snippets/guide/batch-iteration.ts";
import * as calculations from "../../../site/snippets/guide/calculations.ts";
import * as conditions from "../../../site/snippets/guide/conditions.ts";
import * as ordering from "../../../site/snippets/guide/ordering.ts";
import * as through from "../../../site/snippets/guide/through.ts";
import { readFileSync } from "node:fs";
import { pageModelsAndTables, standalonePages } from "../../support/page-models.ts";
import { openPgSchema, type PgSchema } from "../../support/pg.ts";
import { writePgProject } from "../../support/pg-project.ts";
import { scratchDirs } from "../../support/scratch.ts";

const scratch = scratchDirs();

/** A page's Postgres tables (site/snippets/guide/<page>-postgres.sql), with the rows `seed` adds. */
function pageSchema(page: string, seed: string): () => PgSchema {
  let schema: PgSchema;
  beforeAll(async () => {
    schema = await openPgSchema([
      new URL(`../../../site/snippets/guide/${page}-postgres.sql`, import.meta.url),
    ]);
    await schema.pool.query({ text: seed });
  });
  afterAll(() => schema.dispose());
  return () => schema;
}

const ada = "00000000-0000-4000-8000-00000000000a";
const mary = "00000000-0000-4000-8000-00000000000b";

// The Conditions page's examples, on the Postgres table it shows.
describe("the Conditions page's examples, on Postgres", () => {
  const schema = pageSchema(
    "conditions",
    `INSERT INTO users (id, email, role, is_active, created_at, updated_at) VALUES
      ('${ada}', 'ada@example.com', 'admin', true, '2026-01-15Z', '2026-01-15Z'),
      ('${mary}', 'mary@example.com', 'editor', true, '2025-12-01Z', '2025-12-01Z')`,
  );

  test("where, whereNot, and an sql fragment find the users they show", async () => {
    const db = connect(schema().url);

    const { admins, others } = await withDatabase(db, () => conditions.matching());
    const { ada: found, newcomers } = await withDatabase(db, () => conditions.comparing());

    expect(admins.map((user) => user.email)).toEqual(["ada@example.com"]);
    expect(others.map((user) => user.email)).toEqual(["mary@example.com"]);
    expect(found?.id).toBe(ada);
    expect(newcomers.map((user) => user.email)).toEqual(["ada@example.com"]);
  });
});

// The Through associations page's examples, on the Postgres tables it shows.
describe("the Through associations page's examples, on Postgres", () => {
  const schema = pageSchema(
    "through",
    `INSERT INTO authors (id, name) VALUES ('${ada}', 'Ada'), ('${mary}', 'Mary');
     INSERT INTO articles (id, author_id, title) VALUES
       ('${ada}', '${ada}', 'Engines'), ('${mary}', '${mary}', 'On Nothing');
     INSERT INTO tags (name) VALUES ('essays');
     INSERT INTO taggings (article_id, tag_id) SELECT id, 1 FROM articles;`,
  );

  test("reads a tag's articles, and writes through it", async () => {
    const db = connect(schema().url);

    const { articles } = await withDatabase(db, () => through.reading());
    const draft = await withDatabase(db, () => through.writing());

    expect(articles.map((article) => article.title)).toEqual(["Engines", "On Nothing"]);
    const tagged = await withDatabase(db, async () => {
      const tag = await through.Tag.findByOrThrow({ name: "essays" });
      return (await tag.articles().order({ title: "asc" }).toArray()).map((a) => a.title);
    });
    expect(tagged).toEqual([draft.title, "On Nothing"]);
  });
});

// The Ordering and pagination page's examples, on the Postgres table it shows.
describe("the Ordering and pagination page's examples, on Postgres", () => {
  const schema = pageSchema(
    "ordering",
    `INSERT INTO posts (id, title, status, published_at, created_at, updated_at) VALUES
      ('${ada}', 'Alpha', 'published', '2026-01-02Z', '2026-01-02Z', '2026-01-02Z'),
      ('${mary}', 'Gamma', 'draft', NULL, '2026-01-04Z', '2026-01-04Z')`,
  );

  test("order puts NULL first when descending on Postgres, and pages count", async () => {
    const db = connect(schema().url);

    const newest = await withDatabase(db, () => ordering.ordering());
    const response = await withDatabase(db, () =>
      ordering.listPosts(new Request("https://example.com/?page=1")),
    );

    expect(newest.map((post) => post.title)).toEqual(["Gamma", "Alpha"]);
    expect(await response.json()).toMatchObject({ total: 2, hasNext: false });
  });
});

// The Batch iteration page's examples, on the Postgres table it shows.
describe("the Batch iteration page's examples, on Postgres", () => {
  const schema = pageSchema(
    "batch-iteration",
    "INSERT INTO posts (title, published_at) VALUES ('One', '2026-01-01Z'), ('Two', NULL), ('Three', NULL)",
  );

  test("start and finish bound the keys, and order: desc walks down", async () => {
    const titles = await withDatabase(connect(schema().url), () => batchIteration.choosing());

    expect(titles).toEqual(["One", "Two", "Three", "Two", "One"]);
  });
});

// The Calculations page's examples, on the Postgres table it shows.
describe("the Calculations page's examples, on Postgres", () => {
  const schema = pageSchema(
    "calculations",
    `INSERT INTO products (id, name, price_cents, is_available, created_at, updated_at) VALUES
      ('${ada}', 'Pin', 500, true, '2026-01-02Z', '2026-01-02Z'),
      ('${mary}', 'Desk', 30000, false, '2026-03-04Z', '2026-03-04Z')`,
  );

  test("a sum and a grouped count resolve on Postgres", async () => {
    const db = connect(schema().url);

    const { total, newest } = await withDatabase(db, () => calculations.calculations());
    const { byAvailability } = await withDatabase(db, () => calculations.groups());

    expect([total, newest]).toEqual([500, new Date("2026-03-04Z")]);
    expect(byAvailability).toEqual(
      new Map([
        [true, 1],
        [false, 1],
      ]),
    );
  });
});

// Each page shows its Models beside its Postgres tables; the attributes generated from those
// tables are the ones its Models declare. PGlite starts for each schema read, which takes seconds.
describe("the standalone pages’ Models, against their Postgres tables", { timeout: 60_000 }, () => {
  test.each(standalonePages)("%s declares what its tables generate", async (page) => {
    const sql = readFileSync(
      new URL(`../../../site/snippets/guide/${page}-postgres.sql`, import.meta.url),
      "utf8",
    );
    const cwd = writePgProject(
      scratch(`pg-page-${page}-`, true),
      { HYPERDRIVE: {} },
      {
        "migrations/0001_create_tables.sql": sql,
      },
    );

    const { declared, generated } = await pageModelsAndTables(
      cwd,
      page,
      (model) => `${model.toLowerCase()}s`,
    );

    expect(declared).toEqual(generated);
  });
});
