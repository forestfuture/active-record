import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { withDatabase } from "../../../packages/active-record/src/index.ts";
import { connect } from "../../../packages/active-record/src/adapters/postgresql/index.ts";
import * as batchIteration from "../../../site/snippets/pages/batch-iteration/examples.ts";
import * as calculations from "../../../site/snippets/pages/calculations/examples.ts";
import * as conditions from "../../../site/snippets/pages/conditions/examples.ts";
import * as ordering from "../../../site/snippets/pages/ordering/examples.ts";
import * as scopes from "../../../site/snippets/pages/scopes/examples.ts";
import * as through from "../../../site/snippets/pages/through/examples.ts";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Tag } from "../../../site/snippets/pages/through/src/models/tag.ts";
import {
  generatedAttributes,
  pageMigrations,
  pageProject,
  schemaCommand,
  standalonePages,
} from "../../support/page-models.ts";
import { openPgSchema, type PgSchema } from "../../support/pg.ts";
import { writePgProject } from "../../support/pg-project.ts";
import { scratchDirs } from "../../support/scratch.ts";

const scratch = scratchDirs();

/** A copy of a page's project on Postgres: its Models, its Postgres migrations, and the schema they generate. */
async function onPostgres(page: string, outsideTheRepo = false): Promise<string> {
  const migrations = Object.fromEntries(
    pageMigrations(page, "postgres").map((file) => [
      `migrations/${file.pathname.split("/").pop()}`,
      readFileSync(file, "utf8"),
    ]),
  );
  const models = pageProject(page, "src/models/");
  const modelFiles = Object.fromEntries(
    readdirSync(models).map((name) => [
      `src/models/${name}`,
      readFileSync(new URL(name, models), "utf8"),
    ]),
  );
  const cwd = writePgProject(
    scratch(`pg-page-${page}-`, outsideTheRepo),
    { DB: {} },
    {
      ...migrations,
      ...modelFiles,
    },
  );
  const { code, said } = await schemaCommand(cwd);
  if (code !== 0) throw new Error(said);
  return cwd;
}

/**
 * A page's Postgres tables, with the rows `seed` adds, and its Models on them: as an app that
 * moves to Postgres does, the page's ApplicationRecord takes the schema its Postgres migrations
 * generate, and its Models stay as they are.
 */
function pageSchema(page: string, seed: string): () => PgSchema {
  let schema: PgSchema;
  let restore: () => void;
  beforeAll(async () => {
    schema = await openPgSchema(pageMigrations(page, "postgres"));
    await schema.pool.query({ text: seed });
    const generated = await import(join(await onPostgres(page), "src/db/schema.ts"));
    const base = await import(pageProject(page, "src/models/application-record.ts").pathname);
    const { ApplicationRecord } = base as { ApplicationRecord: { schema: unknown } };
    const d1Schema = ApplicationRecord.schema;
    ApplicationRecord.schema = generated.schema;
    restore = () => (ApplicationRecord.schema = d1Schema);
  });
  afterAll(async () => {
    restore();
    await schema.dispose();
  });
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
      const tag = await Tag.findByOrThrow({ name: "essays" });
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

// The Scopes page's examples, on the Postgres tables it shows.
describe("the Scopes page's examples, on Postgres", () => {
  const schema = pageSchema(
    "scopes",
    `INSERT INTO posts (id, title, published_at) VALUES ('${ada}', 'Hello', '2026-02-01Z'), ('${mary}', 'Draft', NULL);
     INSERT INTO products (id, name, is_available) VALUES ('${ada}', 'Pen', true), ('${mary}', 'Ink', false);`,
  );

  test("a scope and a default scope narrow their queries on Postgres", async () => {
    const db = connect(schema().url);

    const { published } = await withDatabase(db, () => scopes.calling());
    const { listed } = await withDatabase(db, () => scopes.defaulting());

    expect([published.map((post) => post.title), listed.map((product) => product.name)]).toEqual([
      ["Hello"],
      ["Pen"],
    ]);
  });
});

// Each page shows its Models beside its Postgres tables, which generate the same attributes as its
// D1 ones. PGlite starts for each schema read, which takes seconds.
describe("the standalone pages’ Postgres tables", { timeout: 60_000 }, () => {
  test.each(standalonePages)("%s's generate the attributes its D1 tables do", async (page) => {
    const cwd = await onPostgres(page, true);

    expect(generatedAttributes(cwd)).toEqual(generatedAttributes(pageProject(page).pathname));
  });
});
