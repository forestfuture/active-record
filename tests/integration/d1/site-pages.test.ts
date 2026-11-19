import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { UnknownAttribute, withDatabase } from "../../../packages/active-record/src/index.ts";
import { connect } from "../../../packages/active-record/src/adapters/d1/index.ts";
import * as conditions from "../../../site/snippets/guide/conditions.ts";
import * as through from "../../../site/snippets/guide/through.ts";
import { createTestDatabase, recordingBatches, type TestDatabase } from "../../support/d1.ts";

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
