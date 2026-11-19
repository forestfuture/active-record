import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { withDatabase } from "../../../packages/active-record/src/index.ts";
import { connect } from "../../../packages/active-record/src/adapters/postgresql/index.ts";
import * as conditions from "../../../site/snippets/guide/conditions.ts";
import * as through from "../../../site/snippets/guide/through.ts";
import { readFileSync } from "node:fs";
import { pageModelsAndTables } from "../../support/page-models.ts";
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

// Each page shows its Models beside its Postgres tables; the attributes generated from those
// tables are the ones its Models declare. PGlite starts for each schema read, which takes seconds.
describe("the standalone pages’ Models, against their Postgres tables", { timeout: 60_000 }, () => {
  test.each(["conditions", "through"])("%s declares what its tables generate", async (page) => {
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
