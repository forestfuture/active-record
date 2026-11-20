import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  type MockInstance,
  onTestFinished,
  test,
  vi,
} from "vite-plus/test";
import {
  MissingAttribute,
  UnknownAttribute,
  withDatabase,
} from "../../../packages/active-record/src/index.ts";
import { inspect } from "node:util";
import { connect } from "../../../packages/active-record/src/adapters/d1/index.ts";
import * as attributeTypes from "../../../site/snippets/pages/attribute-types/examples.ts";
import * as batchIteration from "../../../site/snippets/pages/batch-iteration/examples.ts";
import * as calculations from "../../../site/snippets/pages/calculations/examples.ts";
import * as changeTracking from "../../../site/snippets/pages/change-tracking/examples.ts";
import * as conditions from "../../../site/snippets/pages/conditions/examples.ts";
import * as enums from "../../../site/snippets/pages/enums/examples.ts";
import * as joins from "../../../site/snippets/pages/joins/examples.ts";
import * as models from "../../../site/snippets/pages/models/examples.ts";
import * as ordering from "../../../site/snippets/pages/ordering-and-pagination/examples.ts";
import * as preloadingPage from "../../../site/snippets/pages/preloading/examples.ts";
import * as querying from "../../../site/snippets/pages/querying/examples.ts";
import * as rawStatements from "../../../site/snippets/pages/raw-statements/examples.ts";
import * as serialization from "../../../site/snippets/pages/serialization/examples.ts";
import { Account as SerializedAccount } from "../../../site/snippets/pages/serialization/src/models/account.ts";
import * as scopes from "../../../site/snippets/pages/scopes/examples.ts";
import * as through from "../../../site/snippets/pages/through-associations/examples.ts";
import { createTestDatabase, recordingBatches, type TestDatabase } from "../../support/d1.ts";
import { Post as IteratedPost } from "../../../site/snippets/pages/batch-iteration/src/models/post.ts";
import { ApplicationRecord as PagedRecord } from "../../../site/snippets/pages/ordering-and-pagination/src/models/application-record.ts";
import { Article } from "../../../site/snippets/pages/through-associations/src/models/article.ts";
import {
  pageMigrations,
  pageProject,
  schemaCommand,
  standalonePages,
} from "../../support/page-projects.ts";

/** A D1 database with a page's own tables, from its project's migrations, `tables` emptied before each test. */
function pageDatabase(page: string, tables: string[]): () => TestDatabase {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;
  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase(pageMigrations(page, "migrations")));
  });
  afterAll(() => dispose());
  beforeEach(async () => {
    if (tables.length === 0) return;
    await binding.batch(tables.map((table) => binding.prepare(`DELETE FROM ${table}`)));
  });
  return () => binding;
}

/**
 * console.log, quiet for a describe whose examples log what they show: the tests check the calls
 * instead. Made in beforeAll, so describes that don't run yet don't share it; cleared before each.
 */
function quietLog(): { calls: () => unknown[][] } {
  let log: MockInstance<typeof console.log>;
  beforeAll(() => {
    log = vi.spyOn(console, "log").mockImplementation(() => {});
  });
  afterAll(() => log.mockRestore());
  beforeEach(() => log.mockClear());
  return { calls: () => log.mock.calls };
}

// The Attribute types page's examples, on the products table it shows.
describe("the Attribute types page's examples", () => {
  const binding = pageDatabase("attribute-types", ["products"]);
  const log = quietLog();
  const run = <T>(fn: () => Promise<T> | T) => withDatabase(connect(binding()), async () => fn());

  test("each type holds the JavaScript value the page shows", async () => {
    const lamp = await run(attributeTypes.building);
    const saved = await run(async () => {
      await lamp.save();
      return lamp.reload();
    });

    expect(log.calls()).toEqual([["12.5"], ["09:30:00"], [null]]);
    expect(saved.price).toBe("12.5");
    expect([saved.weightKg, saved.stock, saved.inStock]).toEqual([1.2, 3, true]);
    expect([saved.launchesOn, saved.opensAt]).toEqual(["2026-01-02", "09:30:00"]);
    expect(saved.details).toEqual({ colors: ["red", "blue"] });
    expect(saved.photo).toEqual(new Uint8Array([1, 2, 3]));
    expect(saved.createdAt).toBeInstanceOf(Date);
  });

  test("assigned text is cast, and a decimal rounds to its column's scale", async () => {
    const lamp = await run(attributeTypes.casting);

    expect([lamp.price, lamp.stock, lamp.inStock]).toEqual(["1.56", 42, true]);
  });

  test("a value that can't be cast throws TypeError naming the attribute", () => {
    expect(() => attributeTypes.refusing()).toThrow('Product: "no" isn\'t a boolean for "inStock"');
  });

  test("a form's file saves as bytes", async () => {
    const form = new FormData();
    form.set("photo", new File([new Uint8Array([7, 8])], "photo.png"));

    const product = await run(() => attributeTypes.addPhoto(form));

    expect([product.name, product.photo]).toEqual(["photo.png", new Uint8Array([7, 8])]);
  });
});

// The Enums page's examples, on the tables it shows.
describe("the Enums page's examples", () => {
  const binding = pageDatabase("enums", ["tickets", "conversations", "surveys", "tasks"]);
  const log = quietLog();
  beforeEach(async () => {
    const db = binding();
    await db.batch(
      [
        "INSERT INTO tickets (id, title, status, priority) VALUES ('t1', 'Outage', 'open', 2), ('t2', 'Typo', 'in_progress', 1), ('t3', 'Old', 'closed', 2)",
        "INSERT INTO conversations (id, status, comments) VALUES ('c1', 'active', 'active')",
        "INSERT INTO tasks (id, state) VALUES ('k1', 'open')",
      ].map((sql) => db.prepare(sql)),
    );
  });
  const run = <T>(fn: () => Promise<T> | T) => withDatabase(connect(binding()), async () => fn());

  test("an enum's scopes, predicates and setters work, and conditions take its names", async () => {
    const { ticket, unfinished } = await run(enums.closingUrgent);

    expect([ticket?.title, ticket?.status, unfinished]).toEqual(["Outage", "closed", 1]);
  });

  test("enumValues gives each name's stored value", async () => {
    expect(await run(enums.listingValues)).toEqual({ low: 0, normal: 1, high: 2 });
  });

  test("a prefix and a suffix keep two enums' methods apart", async () => {
    expect(await run(enums.prefixing)).toBe(true);
  });

  test("validate: true reports an unknown value as an inclusion error", async () => {
    const survey = await run(enums.validating);

    expect(survey.errors.fullMessages()).toEqual(["Answer is not included in the list"]);
    expect(log.calls()).toEqual([[["Answer is not included in the list"]]]);
  });

  test("enum: true turns on the methods of an enum read from a CHECK", async () => {
    const task = await run(enums.finishing);

    expect([task.state, task.isDone()]).toEqual(["done", true]);
  });
});

// The Change tracking page's examples, on the users table it shows.
describe("the Change tracking page's examples", () => {
  const binding = pageDatabase("change-tracking", ["users"]);
  const log = quietLog();
  beforeEach(async () => {
    await binding()
      .prepare(
        "INSERT INTO users (id, email, role, is_active, created_at, updated_at) VALUES ('ada', 'ada@example.com', 'admin', 1, '2026-01-15T00:00:00.000Z', '2026-01-15T00:00:00.000Z')",
      )
      .run();
  });
  const run = <T>(fn: () => Promise<T>) => withDatabase(connect(binding()), fn);

  test("a record reports its unsaved changes, and its callback reads the saved one", async () => {
    const ada = await run(changeTracking.changing);

    expect([ada.email, ada.isChanged()]).toEqual(["ada@lovelace.dev", false]);
    expect(log.calls()).toEqual([
      [["email"]],
      ["ada@example.com"],
      [true],
      ["Email changed from ada@example.com to ada@lovelace.dev"],
      [false],
    ]);
  });

  test("restoreAttributes undoes the changes it names", async () => {
    const ada = await run(changeTracking.restoring);

    expect([ada.email, ada.role, ada.changed()]).toEqual(["ada@example.com", "owner", ["role"]]);
  });
});

// The Serialization page's examples, on the accounts table it shows.
describe("the Serialization page's examples", () => {
  const binding = pageDatabase("serialization", ["accounts"]);
  beforeEach(async () => {
    await binding()
      .prepare(
        "INSERT INTO accounts (id, email, password_digest, api_key, iban, created_at, updated_at) VALUES ('ada', 'ada@example.com', 'digest', 'key-1', 'DE89', '2026-01-15T00:00:00.000Z', '2026-01-15T00:00:00.000Z')",
      )
      .run();
  });
  const run = <T>(fn: () => Promise<T>) => withDatabase(connect(binding()), fn);

  test("toJSON leaves the hidden attributes out, and attributes() keeps them", async () => {
    const { body, attributes } = await run(serialization.serializing);
    const json = JSON.parse(body) as Record<string, unknown>;

    expect(Object.keys(json).sort((a, b) => a.localeCompare(b))).toEqual([
      "createdAt",
      "email",
      "iban",
      "id",
      "updatedAt",
    ]);
    expect(json["createdAt"]).toBe("2026-01-15T00:00:00.000Z");
    expect([attributes.passwordDigest, attributes.apiKey]).toEqual(["digest", "key-1"]);
    expect(attributes.createdAt).toBeInstanceOf(Date);
  });

  test("a Model's hidden list replaces its base class's, which it repeats", () => {
    expect(SerializedAccount.hiddenAttributes).toEqual(["passwordDigest", "apiKey"]);
  });

  test("Response.json sends the record without its hidden attributes, or a 404", async () => {
    const found = await run(() =>
      serialization.show(new Request("https://example.com/?email=ada@example.com")),
    );
    const missing = await run(() =>
      serialization.show(new Request("https://example.com/?email=no@example.com")),
    );

    expect(await found.json()).not.toHaveProperty("passwordDigest");
    expect(missing.status).toBe(404);
  });

  test("a printed record shows filtered attributes as [FILTERED]", async () => {
    const { account } = await run(serialization.serializing);

    const printed = inspect(account);

    expect(printed).toContain("email: [FILTERED]");
    expect(printed).toContain("iban: [FILTERED]");
    expect(printed).toContain("passwordDigest: [FILTERED]");
    const relation = await run(async () =>
      inspect(SerializedAccount.where({ email: "ada@example.com" })),
    );
    expect(relation).toContain("params: [ [FILTERED] ]");
  });
});

// The Models page's examples, on the tables it shows.
describe("the Models page's examples", () => {
  const binding = pageDatabase("models", ["products", "billing_accounts"]);
  const log = quietLog();
  beforeEach(async () => {
    await binding()
      .prepare(
        "INSERT INTO products (id, name, status, archived, created_at, updated_at) VALUES ('p1', 'Desk', 'published', 0, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'), ('p2', 'Chair', 'draft', 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
      )
      .run();
  });
  const run = <T>(fn: () => Promise<T>) => withDatabase(connect(binding()), fn);

  test("build generates the id, applies defaults and overrides, and save sets timestamps", async () => {
    const lamp = await run(models.building);

    expect(lamp.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(lamp.publicId).toMatch(/^[0-9a-f-]{36}$/);
    expect([lamp.status, lamp.archived, lamp.metadata]).toEqual([
      "published",
      false,
      { color: "red" },
    ]);
    expect(lamp.createdAt).toBeInstanceOf(Date);
    expect(log.calls().slice(1)).toEqual([["draft"], [false], [null]]);
  });

  test("permit keeps only the named fields", async () => {
    const request = new Request("https://example.com/", {
      method: "POST",
      body: JSON.stringify({ name: "Lamp", status: "published", archived: true }),
    });

    const lamp = await run(() => models.createProduct(request));

    expect([lamp.name, lamp.status, lamp.archived]).toEqual(["Lamp", "draft", false]);
  });

  test("a subclass shares its parent's table, and a Model can name another table", async () => {
    const { published, account } = await run(models.naming);

    expect(published.map((product) => product.name)).toEqual(["Desk"]);
    expect(account.email).toBe("ada@example.com");
  });

  test("a Model declared with define reads a view", async () => {
    const counts = await run(models.countingByView);

    expect(counts.map((count) => [count.status, count.total])).toEqual([
      ["draft", 1],
      ["published", 1],
    ]);
  });
});

// The Preloading page's examples, on the tables it shows.
describe("the Preloading page's examples", () => {
  const binding = pageDatabase("preloading", [
    "likes",
    "photos",
    "videos",
    "comments",
    "articles",
    "profiles",
    "authors",
  ]);
  const log = quietLog();
  beforeEach(async () => {
    const db = binding();
    await db.batch(
      [
        "INSERT INTO authors (id, name) VALUES ('mary', 'Mary'), ('ada', 'Ada')",
        "INSERT INTO profiles (id, author_id, bio) VALUES ('p', 'mary', 'Poet')",
        "INSERT INTO articles (id, author_id, title) VALUES ('x1', 'mary', 'On Nothing'), ('x2', 'ada', 'Engines')",
        "INSERT INTO comments (id, article_id, body) VALUES ('c1', 'x1', 'Hm.')",
        "INSERT INTO photos (id, title) VALUES ('ph', 'Sunset')",
        "INSERT INTO videos (id, title) VALUES ('vi', 'Launch')",
        "INSERT INTO likes (id, likeable_type, likeable_id) VALUES ('l1', 'Photo', 'ph'), ('x9', 'Video', 'vi')",
      ].map((sql) => db.prepare(sql)),
    );
  });

  test("includes loads every author's profile, articles and comments in one round trip", async () => {
    const recording = recordingBatches(binding());

    const authors = await withDatabase(connect(recording.binding), () =>
      preloadingPage.preloading(),
    );

    expect(recording.batches).toEqual([4]); // the authors, profiles, articles, and comments
    expect(authors).toHaveLength(2);
    expect(log.calls()).toContainEqual(["Mary", 1, "Poet"]);
    expect(log.calls()).toContainEqual(["Ada", 1, undefined]);
  });

  test("a polymorphic association preloads each listed Model in the same round trip", async () => {
    const recording = recordingBatches(binding());

    await withDatabase(connect(recording.binding), () => preloadingPage.preloadingPolymorphic());

    expect(recording.batches).toEqual([3]); // the likes, photos, and videos
    expect(
      log
        .calls()
        .map(([title]) => String(title))
        .sort((a, b) => a.localeCompare(b)),
    ).toEqual(["Launch", "Sunset"]);
  });
});

// The Querying page's examples, on the users table it shows.
describe("the Querying page's examples", () => {
  const binding = pageDatabase("querying", ["users"]);
  beforeEach(async () => {
    await binding()
      .prepare(`INSERT INTO users (id, email, role, is_active, created_at, updated_at) VALUES
          ('ada', 'ada@example.com', 'admin', 1, '2026-01-15T00:00:00.000Z', '2026-01-15T00:00:00.000Z'),
          ('grace', 'grace@example.com', 'editor', 1, '2025-12-01T00:00:00.000Z', '2025-12-01T00:00:00.000Z'),
          ('linus', 'linus@example.com', 'admin', 0, '2026-01-20T00:00:00.000Z', '2026-01-20T00:00:00.000Z'),
          ('olive', 'olive@example.com', 'owner', 1, '2025-11-01T00:00:00.000Z', '2025-11-01T00:00:00.000Z')`)
      .run();
  });
  const run = <T>(fn: () => Promise<T>) => withDatabase(connect(binding()), fn);
  const ids = (users: { id: string }[]) => users.map((user) => user.id);

  test("a Relation runs only when asked, and narrowing it returns a new one", async () => {
    expect(ids(await run(querying.building))).toEqual(["linus", "ada"]);
  });

  test("the finders find what their comments say", async () => {
    const found = await run(querying.finding);

    expect([found.ada.id, found.nobody, found.again.id, found.oldest?.id]).toEqual([
      "ada",
      null,
      "ada",
      "ada",
    ]);
    expect([found.newest?.id, found.owner.id]).toEqual(["linus", "olive"]);
  });

  test("pluck, pick and ids read attributes without loading records", async () => {
    const { emails, pairs, latest, adminIds } = await run(querying.reading);

    expect(emails).toEqual([
      "ada@example.com",
      "grace@example.com",
      "linus@example.com",
      "olive@example.com",
    ]);
    expect(pairs[0]).toEqual(["ada", "ada@example.com"]);
    expect(latest).toBe("linus@example.com");
    expect(adminIds.map(String).sort((a, b) => a.localeCompare(b))).toEqual(["ada", "linus"]);
  });

  test("count and the checks answer as their comments say", async () => {
    expect(await run(querying.counting)).toEqual({
      admins: 2,
      hasAdmins: true,
      severalAdmins: true,
      oneOwner: true,
    });
  });

  test("select loads only some attributes, and the primary key", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    onTestFinished(() => log.mockRestore());

    const { first, roles } = await run(querying.selecting);

    expect(log.mock.calls).toEqual([["ada@example.com"], ["ada"]]);
    expect(() => first?.role).toThrow(MissingAttribute);
    expect(roles.map(String).sort((a, b) => a.localeCompare(b))).toEqual([
      "admin",
      "editor",
      "owner",
    ]);
  });

  test("none() matches nothing, merge combines Relations, and toSql keeps values apart", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    onTestFinished(() => log.mockRestore());

    expect(await run(querying.matchingNothing)).toEqual([]);
    expect(ids(await run(querying.merging))).toEqual(["linus"]);
    expect(querying.seeingSql().params).toEqual(["admin", 10]);
  });
});

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
  const binding = pageDatabase("through-associations", ["taggings", "tags", "articles", "authors"]);
  const log = quietLog();
  beforeEach(async () => {
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
    expect(log.calls()).toContainEqual(["essays", 2]);
    expect(log.calls()).toContainEqual(["empty", 0]);
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
    expect(await db.model(Article).count()).toBe(3);
  });
});

// The Ordering and pagination page's examples, on the posts table it shows.
describe("the Ordering and pagination page's examples", () => {
  const binding = pageDatabase("ordering-and-pagination", ["posts"]);
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
    expect([PagedRecord.perPage, PagedRecord.maxPerPage]).toEqual([20, 50]);
  });
});

// The Batch iteration page's examples, on the posts table it shows.
describe("the Batch iteration page's examples", () => {
  const binding = pageDatabase("batch-iteration", ["posts"]);
  const log = quietLog();
  beforeEach(async () => {
    await binding()
      .prepare(
        "INSERT INTO posts (id, title, published_at) VALUES (1, 'One', '2026-01-01T00:00:00.000Z'), (2, 'Two', NULL), (3, 'Three', NULL)",
      )
      .run();
  });
  const logged = () => log.calls().map(([value]) => value);

  test("findEach visits each matching record in key order", async () => {
    await withDatabase(connect(binding()), () => batchIteration.eachPost());

    expect(logged()).toEqual(["Two", "Three"]);
  });

  test("findInBatches yields arrays of up to batchSize records", async () => {
    await withDatabase(connect(binding()), () => batchIteration.eachBatch());

    expect(logged()).toEqual([2, 1]);
  });

  test("inBatches writes each batch's records", async () => {
    const db = connect(binding());

    await withDatabase(db, () => batchIteration.publishDrafts());

    expect(await db.model(IteratedPost).where({ publishedAt: null }).count()).toBe(0);
  });

  test("start and finish bound the keys, and order: desc walks down", async () => {
    const titles = await withDatabase(connect(binding()), () => batchIteration.choosing());

    expect(titles).toEqual(["One", "Two", "Three", "Two", "One"]);
  });
});

// The Calculations page's examples (#344, #345), on the products table it shows.
describe("the Calculations page's examples", () => {
  const binding = pageDatabase("calculations", []);
  const days = ["2026-01-02T00:00:00.000Z", "2026-03-04T00:00:00.000Z"];
  beforeAll(async () => {
    for (const [name, cents, available, createdAt] of [
      ["Pin", 500, 1, days[0]],
      ["Lamp", 12_000, 1, days[1]],
      ["Desk", 30_000, 0, days[0]],
      ["Mug", 1_000, 1, days[0]],
    ] as const) {
      await binding()
        .prepare(
          "INSERT INTO products (id, name, price_cents, is_available, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .bind(name, name, cents, available, createdAt, createdAt)
        .run();
    }
  });

  test("each resolves as its comment says", async () => {
    const results = await withDatabase(connect(binding()), () => calculations.calculations());

    expect(results).toEqual({
      total: 13_500,
      averagePrice: 10_875,
      cheapest: 500,
      newest: new Date(days[1]!),
      topThree: 43_000,
      averageDollars: 108.75,
    });
  });

  test("each grouped calculation resolves as its comment says (#345)", async () => {
    const results = await withDatabase(connect(binding()), () => calculations.groups());

    expect(results).toEqual({
      byAvailability: new Map([
        [true, 3],
        [false, 1],
      ]),
      inStock: 3,
      valueByAvailability: new Map([
        [true, 13_500],
        [false, 30_000],
      ]),
      byBand: new Map([
        [[true, "cheap"], 2],
        [[true, "pricey"], 1],
        [[false, "pricey"], 1],
      ]),
      crowdedCounts: new Map([[true, 3]]),
      largest: new Map([[true, 3]]),
    });
  });
});

// The Scopes page's examples, on the posts and products tables it shows.
describe("the Scopes page's examples", () => {
  const binding = pageDatabase("scopes", ["posts", "products"]);
  beforeEach(async () => {
    const db = binding();
    await db.batch([
      db.prepare(
        "INSERT INTO posts (id, title, published_at) VALUES ('a', 'Hello', '2026-02-01T00:00:00.000Z'), ('b', 'Old', '2025-06-01T00:00:00.000Z'), ('c', 'Draft', NULL)",
      ),
      db.prepare(
        "INSERT INTO products (id, name, is_available) VALUES ('p', 'Pen', 1), ('i', 'Ink', 0)",
      ),
    ]);
  });
  const names = (records: { title?: string; name?: string }[]) =>
    records.map((record) => record.title ?? record.name ?? "").sort((a, b) => a.localeCompare(b));

  test("scopes narrow a query, take arguments, and chain on any Relation", async () => {
    const { published, thisYear, hellos } = await withDatabase(connect(binding()), () =>
      scopes.calling(),
    );

    expect([names(published), names(thisYear), hellos]).toEqual([["Hello", "Old"], ["Hello"], 1]);
  });

  test("a default scope narrows every query and gives new records its values", async () => {
    const { listed, draft } = await withDatabase(connect(binding()), () => scopes.defaulting());

    expect([names(listed), draft.isAvailable]).toEqual([["Pen"], true]);
  });

  test("unscoped() leaves the default scope out", async () => {
    const everything = await withDatabase(connect(binding()), () => scopes.unscoping());

    expect(names(everything)).toEqual(["Ink", "Pen"]);
  });
});

// The Joins page's examples, on the four tables it shows.
describe("the Joins page's examples", () => {
  const binding = pageDatabase("joins", ["comments", "articles", "profiles", "authors"]);
  beforeEach(async () => {
    const db = binding();
    await db.batch(
      [
        "INSERT INTO authors (id, name) VALUES ('mary', 'Mary'), ('ada', 'Ada')",
        "INSERT INTO profiles (id, author_id, bio) VALUES ('p', 'mary', 'Poet')",
        "INSERT INTO articles (id, author_id, title) VALUES ('x1', 'mary', 'On Nothing'), ('x2', 'ada', 'Engines')",
        "INSERT INTO comments (id, article_id, body) VALUES ('c1', 'x1', 'Hm.'), ('c2', 'x1', 'Yes.')",
      ].map((sql) => db.prepare(sql)),
    );
  });
  const names = (records: { name?: string; title?: string }[]) =>
    records.map((record) => record.name ?? record.title);

  test("joins with distinct() finds each author with a commented article once", async () => {
    const commented = await withDatabase(connect(binding()), () => joins.joining());

    expect(names(commented)).toEqual(["Mary"]);
  });

  test("leftJoins keeps the authors with no profile", async () => {
    const everyAuthor = await withDatabase(connect(binding()), () => joins.leftJoining());

    expect(names(everyAuthor).sort((a, b) => String(a).localeCompare(String(b)))).toEqual([
      "Ada",
      "Mary",
    ]);
  });

  test("a merged Relation filters and sorts by the joined Model", async () => {
    const { byMary, byAuthorName } = await withDatabase(connect(binding()), () => joins.merging());

    expect([names(byMary), names(byAuthorName)]).toEqual([
      ["On Nothing"],
      ["Engines", "On Nothing"],
    ]);
  });
});

// The Raw statements page's examples, on the invoices table it shows.
describe("the Raw statements page's examples", () => {
  const binding = pageDatabase("raw-statements", []);
  beforeAll(async () => {
    await binding().batch([
      binding().prepare("INSERT INTO invoices VALUES (1, 10, 1767225600)"), // 2026-01-01
      binding().prepare("INSERT INTO invoices VALUES (2, 20, 1767312000)"), // 2026-01-02
      binding().prepare("INSERT INTO invoices VALUES (3, 30, NULL)"),
    ]);
  });

  test("serialize binds the integer the column holds, so the comparison works", async () => {
    const rows = await rawStatements.paidSince(binding(), new Date("2026-01-02T00:00:00.000Z"));

    expect(rows).toEqual([{ id: 2, total: 20 }]);
  });

  test("deserialize reads the cell as a Date, and NULL as null", async () => {
    expect(await rawStatements.paidAt(binding(), 1)).toEqual(new Date("2026-01-01T00:00:00.000Z"));
    expect(await rawStatements.paidAt(binding(), 3)).toBeNull();
  });
});

// Each page shows its Models beside its D1 tables: its project's schema is what its migrations generate.
describe("the standalone pages' generated schemas", () => {
  test.each(standalonePages)("%s's schema is current", async (page) => {
    expect(await schemaCommand(pageProject(page).pathname, true)).toMatchObject({ code: 0 });
  });
});
