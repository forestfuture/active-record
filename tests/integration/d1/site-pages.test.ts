import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { UnknownAttribute, withDatabase } from "../../../packages/active-record/src/index.ts";
import { connect } from "../../../packages/active-record/src/adapters/d1/index.ts";
import * as conditions from "../../../site/snippets/guide/conditions.ts";
import * as ordering from "../../../site/snippets/guide/ordering.ts";
import * as through from "../../../site/snippets/guide/through.ts";
import { cpSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createTestDatabase, recordingBatches, type TestDatabase } from "../../support/d1.ts";
import { pageModelsAndTables } from "../../support/page-models.ts";
import { scratchDirs } from "../../support/scratch.ts";

const scratch = scratchDirs();

/** A D1 database with a page's own tables (site/snippets/guide/<page>-d1.sql), emptied before each test. */
function pageDatabase(page: string, tables: string[]): () => TestDatabase {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;
  beforeAll(async () => {
    const schema = new URL(`../../../site/snippets/guide/${page}-d1.sql`, import.meta.url);
    ({ db: binding, dispose } = await createTestDatabase(schema));
  });
  afterAll(() => dispose());
  beforeEach(async () => {
    await binding.batch(tables.map((table) => binding.prepare(`DELETE FROM ${table}`)));
  });
  return () => binding;
}

// The Conditions page's examples, on the users table it shows.
describe("the Conditions page's examples", () => {
  const binding = pageDatabase("conditions", ["users"]);
  beforeEach(async () => {
    await binding()
      .prepare(
        `INSERT INTO users (id, email, role, is_active, created_at, updated_at) VALUES
          ('ada', 'ada@example.com', 'admin', 1, '2026-01-15T00:00:00.000Z', '2026-01-15T00:00:00.000Z'),
          ('grace', 'grace@example.com', 'editor', 1, '2025-12-01T00:00:00.000Z', '2025-12-01T00:00:00.000Z'),
          ('linus', 'linus@example.com', 'admin', 0, '2026-01-20T00:00:00.000Z', '2026-01-20T00:00:00.000Z'),
          ('hopper', 'hopper@example.com', NULL, 0, '2025-11-01T00:00:00.000Z', '2025-11-01T00:00:00.000Z')`,
      )
      .run();
  });
  const ids = (users: { id: string }[]) => users.map((user) => user.id).sort();

  test("where matches every attribute, whereNot leaves out NULL, and or takes either", async () => {
    const { admins, others, either } = await withDatabase(connect(binding()), () =>
      conditions.matching(),
    );

    expect(ids(admins)).toEqual(["ada"]);
    expect(ids(others)).toEqual(["grace"]);
    expect(ids(either)).toEqual(["ada", "hopper", "linus"]);
  });

  test("a misspelled attribute throws UnknownAttribute", () => {
    expect(() => conditions.misspelling()).toThrow(UnknownAttribute);
  });

  test("an sql fragment and a column's value find the users they show", async () => {
    const { ada, newcomers } = await withDatabase(connect(binding()), () => conditions.comparing());

    expect(ada?.id).toBe("ada");
    expect(ids(newcomers)).toEqual(["ada", "linus"]);
  });

  test("rewhere replaces the role, and excluding leaves out the record", async () => {
    const { activeAdmins, everyoneElse } = await withDatabase(connect(binding()), () =>
      conditions.rewriting(),
    );

    expect(ids(activeAdmins)).toEqual(["ada"]);
    expect(ids(everyoneElse)).toEqual(["grace", "hopper", "linus"]);
  });
});

// The Through associations page's examples, on the four tables it shows.
describe("the Through associations page's examples", () => {
  const binding = pageDatabase("through", ["taggings", "tags", "articles", "authors"]);
  // The examples log what they show; the tests check it here rather than print it.
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  afterAll(() => log.mockRestore());
  beforeEach(async () => {
    log.mockClear();
    const db = binding();
    await db.batch([
      db.prepare("INSERT INTO authors (id, name) VALUES ('mary', 'Mary'), ('ada', 'Ada')"),
      db.prepare(
        "INSERT INTO articles (id, author_id, title) VALUES ('x1', 'mary', 'On Nothing'), ('x2', 'ada', 'Engines')",
      ),
      db.prepare("INSERT INTO tags (id, name) VALUES (1, 'essays'), (2, 'empty')"),
    ]);
  });
  const tagBoth = () =>
    binding()
      .prepare("INSERT INTO taggings (id, article_id, tag_id) VALUES (1, 'x2', 1), (2, 'x1', 1)")
      .run();

  test("reads a tag's articles, and an article's tags", async () => {
    await tagBoth();

    const { articles, tags } = await withDatabase(connect(binding()), () => through.reading());

    expect(articles.map((article) => article.title)).toEqual(["Engines", "On Nothing"]);
    expect(tags.map((tag) => tag.name)).toEqual(["essays"]);
  });

  test("preloads every tag's articles in one round trip", async () => {
    await tagBoth();
    const recording = recordingBatches(binding());

    await withDatabase(connect(recording.binding), () => through.preloading());

    expect(recording.batches).toEqual([3]); // the tags, their taggings, and their articles
    expect(log).toHaveBeenCalledWith("essays", 2);
    expect(log).toHaveBeenCalledWith("empty", 0);
  });

  test("follows each article's author through source", async () => {
    await tagBoth();

    const writers = await withDatabase(connect(binding()), () => through.followingSource());

    expect(writers.map((writer) => writer.name).sort()).toEqual(["Ada", "Mary"]);
  });

  test("reaches a tagging's author through its article", async () => {
    await tagBoth();

    const author = await withDatabase(connect(binding()), () => through.throughBelongsTo());

    expect(author?.name).toBe("Ada");
  });

  test("removes a pushed article's tagging and keeps a created one's", async () => {
    const db = connect(binding());

    const draft = await withDatabase(db, () => through.writing());

    const taggings = await binding().prepare("SELECT article_id FROM taggings").all();
    expect(taggings.results).toEqual([{ article_id: draft.id }]);
    expect(await db.model(through.Article).count()).toBe(3);
  });
});

// The Ordering and pagination page's examples, on the posts table it shows.
describe("the Ordering and pagination page's examples", () => {
  const binding = pageDatabase("ordering", ["posts"]);
  beforeEach(async () => {
    await binding()
      .prepare(
        `INSERT INTO posts (id, title, status, published_at, created_at, updated_at) VALUES
          ('a', 'Alpha', 'published', '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z', '2026-01-02T00:00:00.000Z'),
          ('b', 'Beta', 'published', '2026-01-03T00:00:00.000Z', '2026-01-03T00:00:00.000Z', '2026-01-03T00:00:00.000Z'),
          ('c', 'Gamma', 'draft', NULL, '2026-01-04T00:00:00.000Z', '2026-01-04T00:00:00.000Z'),
          ('d', 'Delta', 'archived', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
      )
      .run();
  });
  const titles = (posts: { title: string }[]) => posts.map((post) => post.title);

  test("order sorts by each key in turn, with NULL last when descending on D1", async () => {
    const newest = await withDatabase(connect(binding()), () => ordering.ordering());

    expect(titles(newest)).toEqual(["Beta", "Alpha", "Delta", "Gamma"]);
  });

  test("inOrderOf keeps the listed values first, and with filter: false the rest after", async () => {
    const { byStatus, everyPost } = await withDatabase(connect(binding()), () =>
      ordering.inOrder(),
    );

    expect(byStatus.map((post) => post.status)).toEqual(["published", "published", "draft"]);
    expect(everyPost.map((post) => post.status).slice(0, 2)).toEqual(["published", "published"]);
    expect(everyPost).toHaveLength(4);
  });

  test("a page from the query string has its records and total", async () => {
    const response = await withDatabase(connect(binding()), () =>
      ordering.listPosts(new Request("https://example.com/?page=1")),
    );

    expect(await response.json()).toMatchObject({ page: 1, perPage: 20, total: 4, hasNext: false });
  });

  test("a page without its count still says whether there's a next one", async () => {
    const { records, hasNext } = await withDatabase(connect(binding()), () => ordering.countless());

    expect([records.length, hasNext]).toEqual([2, false]);
  });

  test("the base class sets the page size and its cap", () => {
    expect([ordering.ApplicationRecord.perPage, ordering.ApplicationRecord.maxPerPage]).toEqual([
      20, 50,
    ]);
  });
});

// Each page shows its Models beside its D1 tables; the attributes generated from those tables are
// the ones its Models declare.
describe("the standalone pages’ Models, against their D1 tables", () => {
  test.each(["conditions", "through", "ordering"])(
    "%s declares what its tables generate",
    async (page) => {
      const cwd = scratch(`page-${page}-`);
      writeFileSync(
        join(cwd, "active-record.jsonc"),
        '{ "databases": { "DB": { "adapter": "d1" } } }',
      );
      writeFileSync(
        join(cwd, "wrangler.jsonc"),
        '{ "name": "page", "d1_databases": [{ "binding": "DB", "database_name": "page", "database_id": "x" }] }',
      );
      mkdirSync(join(cwd, "migrations"));
      cpSync(
        new URL(`../../../site/snippets/guide/${page}-d1.sql`, import.meta.url),
        join(cwd, "migrations/0001_create_tables.sql"),
      );

      const { declared, generated } = await pageModelsAndTables(
        cwd,
        page,
        (model) => `${model.toLowerCase()}s`,
      );

      expect(declared).toEqual(generated);
    },
  );
});
