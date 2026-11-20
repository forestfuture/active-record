import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  onTestFinished,
  test,
  vi,
} from "vite-plus/test";
import { withDatabase } from "../../../packages/active-record/src/index.ts";
import { connect } from "../../../packages/active-record/src/adapters/postgresql/index.ts";
import * as associations from "../../../site/snippets/pages/associations/examples.ts";
import { Article as Story } from "../../../site/snippets/pages/associations/src/models/article.ts";
import { Author as Writer } from "../../../site/snippets/pages/associations/src/models/author.ts";
import { Comment as Remark } from "../../../site/snippets/pages/associations/src/models/comment.ts";
import { Profile as Bio } from "../../../site/snippets/pages/associations/src/models/profile.ts";
import * as attributeTypes from "../../../site/snippets/pages/attribute-types/examples.ts";
import { Article as AutosavedArticle } from "../../../site/snippets/pages/autosaving/src/models/article.ts";
import { Comment as AutosavedComment } from "../../../site/snippets/pages/autosaving/src/models/comment.ts";
import * as autosaving from "../../../site/snippets/pages/autosaving/examples.ts";
import * as batchIteration from "../../../site/snippets/pages/batch-iteration/examples.ts";
import * as calculations from "../../../site/snippets/pages/calculations/examples.ts";
import * as changeTracking from "../../../site/snippets/pages/change-tracking/examples.ts";
import * as conditions from "../../../site/snippets/pages/conditions/examples.ts";
import * as counterCaches from "../../../site/snippets/pages/counter-caches/examples.ts";
import * as enums from "../../../site/snippets/pages/enums/examples.ts";
import * as joins from "../../../site/snippets/pages/joins/examples.ts";
import * as models from "../../../site/snippets/pages/models/examples.ts";
import * as ordering from "../../../site/snippets/pages/ordering-and-pagination/examples.ts";
import * as preloadingPage from "../../../site/snippets/pages/preloading/examples.ts";
import * as querying from "../../../site/snippets/pages/querying/examples.ts";
import * as serialization from "../../../site/snippets/pages/serialization/examples.ts";
import * as scopes from "../../../site/snippets/pages/scopes/examples.ts";
import * as touching from "../../../site/snippets/pages/touching/examples.ts";
import * as through from "../../../site/snippets/pages/through-associations/examples.ts";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { Post as IteratedPost } from "../../../site/snippets/pages/batch-iteration/src/models/post.ts";
import { Invoice } from "../../../site/snippets/pages/raw-statements/src/models/invoice.ts";
import { Tag } from "../../../site/snippets/pages/through-associations/src/models/tag.ts";
import {
  generatedAttributes,
  pageMigrations,
  pageProject,
  schemaCommand,
  standalonePages,
} from "../../support/page-projects.ts";
import { statementKinds } from "../../support/statement-kinds.ts";
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
  let schema: PgSchema | undefined;
  let restore = () => {};
  // PGlite reads the Postgres schema, which takes seconds with coverage on.
  beforeAll(async () => {
    schema = await openPgSchema(pageMigrations(page, "postgres"));
    await schema.pool.query({ text: seed });
    const generated = await import(join(await onPostgres(page), "src/db/schema.ts"));
    const base = await import(pageProject(page, "src/models/application-record.ts").pathname);
    const { ApplicationRecord } = base as { ApplicationRecord: { schema: unknown } };
    const d1Schema = ApplicationRecord.schema;
    ApplicationRecord.schema = generated.schema;
    restore = () => (ApplicationRecord.schema = d1Schema);
  }, 60_000);
  afterAll(async () => {
    restore();
    await schema?.dispose();
  });
  return () => schema!;
}

const ada = "00000000-0000-4000-8000-00000000000a";
const mary = "00000000-0000-4000-8000-00000000000b";

// The Attribute types page's examples, on the products table it shows, on Postgres.
describe("the Attribute types page's examples, on Postgres", () => {
  const schema = pageSchema("attribute-types", "SELECT 1");

  const run = <T>(fn: () => Promise<T> | T) =>
    withDatabase(connect(schema().url), async () => fn());

  test("each type holds the JavaScript value the page shows", async () => {
    const lamp = await run(attributeTypes.building);
    const saved = await run(async () => {
      await lamp.save();
      return lamp.reload();
    });

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

// The Enums page's examples, on the tables it shows, on Postgres.
describe("the Enums page's examples, on Postgres", () => {
  const schema = pageSchema(
    "enums",
    "INSERT INTO tickets (id, title, status, priority) VALUES ('00000000-0000-4000-8000-000000000001', 'Outage', 'open', 2), ('00000000-0000-4000-8000-000000000002', 'Typo', 'in_progress', 1), ('00000000-0000-4000-8000-000000000003', 'Old', 'closed', 2);\nINSERT INTO conversations (id, status, comments) VALUES ('00000000-0000-4000-8000-000000000004', 'active', 'active');\nINSERT INTO tasks (id, state) VALUES ('00000000-0000-4000-8000-000000000005', 'open')",
  );
  const run = <T>(fn: () => Promise<T> | T) =>
    withDatabase(connect(schema().url), async () => fn());

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
  });

  test("enum: true turns on the methods of an enum read from a CHECK", async () => {
    const task = await run(enums.finishing);

    expect([task.state, task.isDone()]).toEqual(["done", true]);
  });
});

// The Change tracking page's examples, on the users table it shows, on Postgres.
describe("the Change tracking page's examples, on Postgres", () => {
  const schema = pageSchema("change-tracking", "SELECT 1");

  beforeEach(async () => {
    await schema().pool.query({ text: "DELETE FROM users" });
    await schema().pool.query({
      text: "INSERT INTO users (id, email, role, is_active, created_at, updated_at) VALUES ('00000000-0000-4000-8000-00000000000a', 'jane@example.com', 'admin', true, '2026-01-15T00:00:00.000Z', '2026-01-15T00:00:00.000Z')",
    });
  });
  const run = <T>(fn: () => Promise<T>) => withDatabase(connect(schema().url), fn);

  test("a record reports its unsaved changes, and its callback reads the saved one", async () => {
    const ada = await run(changeTracking.changing);

    expect([ada.email, ada.isChanged()]).toEqual(["jane@work.example", false]);
  });

  test("restoreAttributes undoes the changes it names", async () => {
    const ada = await run(changeTracking.restoring);

    expect([ada.email, ada.role, ada.changed()]).toEqual(["jane@example.com", "owner", ["role"]]);
  });
});

// The Serialization page's examples, on the accounts table it shows, on Postgres.
describe("the Serialization page's examples, on Postgres", () => {
  const schema = pageSchema(
    "serialization",
    "INSERT INTO accounts (id, email, password_digest, api_key, iban, created_at, updated_at) VALUES ('00000000-0000-4000-8000-00000000000a', 'jane@example.com', 'digest', 'key-1', 'DE89', '2026-01-15T00:00:00.000Z', '2026-01-15T00:00:00.000Z')",
  );
  const run = <T>(fn: () => Promise<T>) => withDatabase(connect(schema().url), fn);

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
});

// The Models page's examples, on the tables it shows, on Postgres.
describe("the Models page's examples, on Postgres", () => {
  const schema = pageSchema("models", "SELECT 1");
  beforeEach(async () => {
    await schema().pool.query({ text: "DELETE FROM products; DELETE FROM billing_accounts" });
    await schema().pool.query({
      text: "INSERT INTO products (id, name, status, archived, created_at, updated_at) VALUES ('00000000-0000-4000-8000-000000000001', 'Desk', 'published', 0, '2026-01-01Z', '2026-01-01Z'), ('00000000-0000-4000-8000-000000000002', 'Chair', 'draft', 1, '2026-01-01Z', '2026-01-01Z')",
    });
  });
  const run = <T>(fn: () => Promise<T>) => withDatabase(connect(schema().url), fn);

  test("build generates the id, applies defaults and overrides, and save sets timestamps", async () => {
    vi.spyOn(console, "log").mockImplementation(() => {});
    onTestFinished(() => {
      vi.restoreAllMocks();
    });
    const lamp = await run(models.building);

    expect(lamp.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(lamp.publicId).toMatch(/^[0-9a-f-]{36}$/);
    expect([lamp.status, lamp.archived, lamp.metadata]).toEqual([
      "published",
      false,
      { color: "red" },
    ]);
    expect(lamp.createdAt).toBeInstanceOf(Date);
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
    expect(account.email).toBe("jane@example.com");
  });

  test("a Model declared with define reads a view", async () => {
    const counts = await run(models.countingByView);

    expect(counts.map((count) => [count.status, count.total])).toEqual([
      ["draft", 1],
      ["published", 1],
    ]);
  });
});

// The Preloading page's examples, on the Postgres tables it shows.
describe("the Preloading page's examples, on Postgres", () => {
  const schema = pageSchema(
    "preloading",
    "INSERT INTO authors (id, name) VALUES ('00000000-0000-4000-8000-000000000001', 'Jane'), ('00000000-0000-4000-8000-000000000002', 'Sam');\nINSERT INTO profiles (id, author_id, bio) VALUES ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', 'Poet');\nINSERT INTO articles (id, author_id, title) VALUES ('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000001', 'On Nothing'), ('00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000002', 'Engines');\nINSERT INTO comments (id, article_id, body) VALUES ('00000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000004', 'Hm.');\nINSERT INTO photos (id, title) VALUES ('00000000-0000-4000-8000-000000000007', 'Sunset');\nINSERT INTO videos (id, title) VALUES ('00000000-0000-4000-8000-000000000008', 'Launch');\nINSERT INTO likes (id, likeable_type, likeable_id) VALUES ('00000000-0000-4000-8000-000000000009', 'Photo', '00000000-0000-4000-8000-000000000007'), ('00000000-0000-4000-8000-000000000000', 'Video', '00000000-0000-4000-8000-000000000008')",
  );

  test("includes and a polymorphic include load what the page shows", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    onTestFinished(() => log.mockRestore());
    const db = connect(schema().url);

    await withDatabase(db, () => preloadingPage.preloading());
    await withDatabase(db, () => preloadingPage.preloadingPolymorphic());

    expect(log.mock.calls).toContainEqual(["Jane", 1, "Poet"]);
    expect(
      log.mock.calls
        .slice(2)
        .map(([title]) => String(title))
        .sort((a, b) => a.localeCompare(b)),
    ).toEqual(["Launch", "Sunset"]);
  });
});

// The Autosaving page's examples, on the tables it shows, on Postgres.
describe("the Autosaving page's examples, on Postgres", () => {
  const schema = pageSchema("autosaving", "SELECT 1");
  beforeEach(async () => {
    await schema().pool.query({
      text: "DELETE FROM comments; DELETE FROM profiles; DELETE FROM articles; DELETE FROM authors",
    });
    await schema().pool.query({
      text: "INSERT INTO authors (id, name) VALUES ('00000000-0000-4000-8000-000000000001', 'Jane');\nINSERT INTO articles (id, author_id, title) VALUES ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'On Nothing'), ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', 'Draft');\nINSERT INTO comments (id, article_id, body) VALUES ('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000003', 'Hm.')",
    });
  });
  const db = () => connect(schema().url);
  const run = <T>(fn: () => Promise<T>) => withDatabase(db(), fn);
  const titles = async () =>
    await db().model(AutosavedArticle).order({ title: "asc" }).pluck("title");

  test("a record created through a hasMany gets its owner's key", async () => {
    const comment = await run(autosaving.creatingThrough);

    expect(comment.articleId).toBe("00000000-0000-4000-8000-000000000002");
  });

  test("records built through associations save with their owner", async () => {
    const author = await run(autosaving.savingAGraph);

    expect(author.isPersisted()).toBe(true);
    expect(await titles()).toEqual(["Draft", "Getting started", "Going further", "On Nothing"]);
  });

  test("autosave: true saves the loaded records that changed", async () => {
    await run(autosaving.savingChanges);

    expect(await titles()).toEqual(["DRAFT", "ON NOTHING"]);
  });

  test("a record marked for destruction is destroyed, with its comments, when its owner saves", async () => {
    await run(autosaving.removingDrafts);

    expect(await titles()).toEqual(["On Nothing"]);
    expect(await db().model(AutosavedComment).count()).toBe(0);
  });
});

// The Counter caches page's examples, on the tables it shows, on Postgres.
describe("the Counter caches page's examples, on Postgres", () => {
  const schema = pageSchema("counter-caches", "SELECT 1");
  beforeEach(async () => {
    await schema().pool.query({ text: "DELETE FROM comments; DELETE FROM articles" });
    await schema().pool.query({
      text: "INSERT INTO articles (id, title, comments_count) VALUES ('00000000-0000-4000-8000-00000000000a', 'Hello', 5)",
    });
  });
  const run = <T>(fn: () => Promise<T>) => withDatabase(connect(schema().url), fn);
  // A count that drifted to 5, with no comments, tells the counter from the rows.

  test("creating a comment counts it in, and destroying it counts it out", async () => {
    const article = await run(counterCaches.counting);

    expect(article.commentsCount).toBe(5);
    expect((await run(() => article.reload())).commentsCount).toBe(5);
  });

  test("size() reads the counter, not the rows", async () => {
    expect(await run(counterCaches.reading)).toBe(5);
  });

  test("resetCounters sets the count from the rows, and touches the article", async () => {
    const article = await run(counterCaches.resetting);

    expect(article.commentsCount).toBe(0);
    expect(article.updatedAt).toBeInstanceOf(Date);
  });
});

// The Touching page's examples, on the tables it shows, on Postgres.
describe("the Touching page's examples, on Postgres", () => {
  const schema = pageSchema("touching", "SELECT 1");
  beforeEach(async () => {
    await schema().pool.query({
      text: "DELETE FROM profiles; DELETE FROM users; DELETE FROM comments; DELETE FROM articles; DELETE FROM blogs",
    });
    await schema().pool.query({
      text: "INSERT INTO blogs (id, updated_at) VALUES ('00000000-0000-4000-8000-000000000001', '2020-01-01T00:00:00.000Z');\nINSERT INTO articles (id, blog_id, title, updated_at) VALUES ('00000000-0000-4000-8000-000000000002', '00000000-0000-4000-8000-000000000001', 'Hello', '2020-01-01T00:00:00.000Z');\nINSERT INTO comments (id, article_id, body, updated_at) VALUES ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000002', 'Old', '2020-01-01T00:00:00.000Z');\nINSERT INTO users (id, name, updated_at) VALUES ('00000000-0000-4000-8000-000000000004', 'Sam', '2020-01-01T00:00:00.000Z');\nINSERT INTO profiles (id, user_id, bio, updated_at) VALUES ('00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000004', 'Poet', '2020-01-01T00:00:00.000Z')",
    });
  });
  const updatedAt = async (table: string) => {
    const { rows } = await schema().pool.query({ text: `SELECT updated_at FROM ${table}` });
    return (rows[0]!["updated_at"] as Date).toISOString();
  };
  const stale = "2020-01-01T00:00:00.000Z";
  const run = <T>(fn: () => Promise<T>, onQuery?: (event: { sql: string }) => void) =>
    withDatabase(connect(schema().url, { onQuery }), fn);

  test("each write to a comment touches its article, and the article its blog", async () => {
    await run(touching.touching);

    expect(await updatedAt("articles")).not.toBe(stale);
    expect(await updatedAt("blogs")).toBe(await updatedAt("articles"));
  });

  test("a named attribute is set with updatedAt", async () => {
    const article = await run(touching.replying);

    expect(article.lastCommentedAt).toEqual(article.updatedAt);
  });

  test("an import inside noTouching touches its article once, after it", async () => {
    const events: { sql: string }[] = [];

    await run(touching.importing, (event) => void events.push(event));

    const kinds = statementKinds(events);
    expect(kinds.filter((kind) => kind === "UPDATE")).toHaveLength(2); // the article, then its blog
    expect(kinds.slice(-2)).toEqual(["UPDATE", "UPDATE"]);
    expect(await updatedAt("articles")).not.toBe(stale);
  });

  test("updating a user touches its profile", async () => {
    await run(touching.renaming);

    expect(await updatedAt("profiles")).not.toBe(stale);
  });
});

// The Associations page's examples, on the tables it shows, on Postgres.
describe("the Associations page's examples, on Postgres", () => {
  const schema = pageSchema("associations", "SELECT 1");
  beforeEach(async () => {
    await schema().pool.query({
      text: "DELETE FROM likes; DELETE FROM videos; DELETE FROM photos; DELETE FROM categories; DELETE FROM comments; DELETE FROM articles; DELETE FROM profiles; DELETE FROM authors",
    });
    await schema().pool.query({
      text: "INSERT INTO authors (id, name) VALUES ('00000000-0000-4000-8000-000000000001', 'Jane'), ('00000000-0000-4000-8000-000000000002', 'Sam');\nINSERT INTO profiles (id, author_id, bio) VALUES ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', 'Poet');\nINSERT INTO articles (id, author_id, title, published) VALUES ('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000001', 'On Nothing', true), ('00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000001', 'Draft', false);\nINSERT INTO comments (id, article_id, body) VALUES ('00000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000004', 'Hm.');\nINSERT INTO categories (id, name, parent_id) VALUES ('00000000-0000-4000-8000-000000000007', 'Top', NULL), ('00000000-0000-4000-8000-000000000008', 'Beta', '00000000-0000-4000-8000-000000000007'), ('00000000-0000-4000-8000-000000000009', 'Alpha', '00000000-0000-4000-8000-000000000007');\nINSERT INTO photos (id, title) VALUES ('00000000-0000-4000-8000-00000000000a', 'Sunset');\nINSERT INTO videos (id, title) VALUES ('00000000-0000-4000-8000-00000000000b', 'Launch');\nINSERT INTO likes (id, likeable_type, likeable_id) VALUES ('00000000-0000-4000-8000-00000000000c', 'Photo', '00000000-0000-4000-8000-00000000000a')",
    });
  });
  const db = (onQuery?: (event: { sql: string }) => void) => connect(schema().url, { onQuery });
  const run = <T>(fn: () => Promise<T>, onQuery?: (event: { sql: string }) => void) =>
    withDatabase(db(onQuery), fn);
  const names = (records: { title?: string; name?: string; bio?: string | null }[]) =>
    records.map((record) => record.title ?? record.name ?? record.bio);

  test("a belongsTo reads its record, and set() points it at another", async () => {
    const { author, article } = await run(associations.readingTheAuthor);
    const ada = await db().model(Writer).findByOrThrow({ name: "Sam" });

    expect([author?.name, article.authorId]).toEqual(["Jane", ada.id]);
  });

  test("a hasMany reads, builds, and bulk-deletes the owner's records", async () => {
    const articles = await run(associations.readingArticles);

    expect(names(articles).sort((a, b) => String(a).localeCompare(String(b)))).toEqual([
      "Draft",
      "On Nothing",
    ]);
    expect(await db().model(Story).where({ title: "Untitled" }).count()).toBe(0);
  });

  test("a hasOne reads its record, and set() replaces it", async () => {
    expect((await run(associations.readingTheProfile))?.bio).toBe("Poet");

    await run(associations.replacingTheProfile);

    expect(await db().model(Bio).pluck("bio")).toEqual(["Novelist"]);
  });

  test("a polymorphic like reads its record, and moves to a video", async () => {
    const { liked, likes } = await run(associations.liking);

    expect(liked?.constructor.name).toBe("Photo");
    expect(likes).toHaveLength(1);
  });

  test("a loaded association is cached, and points back without a query", async () => {
    const reads: string[] = [];
    const { author, again } = await run(associations.caching, ({ sql }) => void reads.push(sql));
    const back = await run(associations.pointingBack);

    expect(reads).toHaveLength(2); // the article, then its author once
    expect(again).toBe(author);
    expect(back.sameAuthor).toBe(back.author);
  });

  test("a scoped association reads only its records, and a self-reference nests", async () => {
    const published = await run(associations.scoping);
    const { top, children, parent } = await run(associations.nesting);

    expect(names(published)).toEqual(["On Nothing"]);
    expect([top?.name, names(children ?? []), parent?.name]).toEqual([
      "Top",
      ["Alpha", "Beta"],
      "Top",
    ]);
  });

  test("deleteAll through an association, and destroying with dependents", async () => {
    await run(associations.deletingComments);
    expect(await db().model(Remark).count()).toBe(0);

    await run(associations.destroying);

    expect(await db().model(Writer).pluck("name")).toEqual(["Sam"]);
    expect([await db().model(Story).count(), await db().model(Bio).count()]).toEqual([0, 0]);
  });
});

// The Querying page's examples, on the Postgres table it shows.
describe("the Querying page's examples, on Postgres", () => {
  const schema = pageSchema(
    "querying",
    `INSERT INTO users (id, email, role, is_active, created_at, updated_at) VALUES
      ('${ada}', 'jane@example.com', 'admin', true, '2026-01-15Z', '2026-01-15Z'),
      ('${mary}', 'mary@example.com', 'owner', true, '2025-11-01Z', '2025-11-01Z')`,
  );

  test("finders, plucks and checks resolve, and toSql shows numbered placeholders", async () => {
    const db = connect(schema().url);
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    onTestFinished(() => log.mockRestore());

    const { again, newest, owner } = await withDatabase(db, () => querying.finding());
    const { emails } = await withDatabase(db, () => querying.reading());
    const counts = await withDatabase(db, () => querying.counting());
    const { sql } = await withDatabase(db, async () => querying.seeingSql());

    expect([again.email, newest?.email, owner.email]).toEqual([
      "jane@example.com",
      "jane@example.com",
      "mary@example.com",
    ]);
    expect(emails).toEqual(["jane@example.com", "mary@example.com"]);
    expect(counts).toEqual({ admins: 1, hasAdmins: true, severalAdmins: false, oneOwner: true });
    // oxlint-disable-next-line active-record/no-sql-text -- the page says Postgres numbers its placeholders
    expect(sql).toMatch(/\$1.*\$2/);
  });
});

// The Conditions page's examples, on the Postgres table it shows.
describe("the Conditions page's examples, on Postgres", () => {
  const schema = pageSchema(
    "conditions",
    `INSERT INTO users (id, email, role, is_active, created_at, updated_at) VALUES
      ('${ada}', 'jane@example.com', 'admin', true, '2026-01-15Z', '2026-01-15Z'),
      ('${mary}', 'mary@example.com', 'editor', true, '2025-12-01Z', '2025-12-01Z')`,
  );

  test("where, whereNot, and an sql fragment find the users they show", async () => {
    const db = connect(schema().url);

    const { admins, others } = await withDatabase(db, () => conditions.matching());
    const { user: found, newcomers } = await withDatabase(db, () => conditions.comparing());

    expect(admins.map((user) => user.email)).toEqual(["jane@example.com"]);
    expect(others.map((user) => user.email)).toEqual(["mary@example.com"]);
    expect(found?.id).toBe(ada);
    expect(newcomers.map((user) => user.email)).toEqual(["jane@example.com"]);
  });
});

// The Through associations page's examples, on the Postgres tables it shows.
describe("the Through associations page's examples, on Postgres", () => {
  const schema = pageSchema(
    "through-associations",
    `INSERT INTO authors (id, name) VALUES ('${ada}', 'Sam'), ('${mary}', 'Jane');
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
    "ordering-and-pagination",
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

  test("inOrderOf keeps the listed values first, and a page without its count still pages", async () => {
    const db = connect(schema().url);

    const { byStatus, everyPost } = await withDatabase(db, () => ordering.inOrder());
    const { records, hasNext } = await withDatabase(db, () => ordering.countless());

    expect(byStatus.map((post) => post.status)).toEqual(["published", "draft"]);
    expect(everyPost).toHaveLength(2);
    expect([records, hasNext]).toEqual([[], false]);
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

  test("findEach and findInBatches visit the records in key order", async () => {
    const log = vi.spyOn(console, "log").mockImplementation(() => {});
    onTestFinished(() => log.mockRestore());

    await withDatabase(connect(schema().url), () => batchIteration.eachPost());
    await withDatabase(connect(schema().url), () => batchIteration.eachBatch());

    expect(log.mock.calls.map(([value]) => value)).toEqual(["Two", "Three", 2, 1]);
  });

  test("inBatches writes each batch's records", async () => {
    const db = connect(schema().url);

    await withDatabase(db, () => batchIteration.publishDrafts());

    expect(await db.model(IteratedPost).where({ publishedAt: null }).count()).toBe(0);
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

    const values = await withDatabase(db, () => calculations.calculations());
    const { largest, ...groups } = await withDatabase(db, () => calculations.groups());

    expect(values).toEqual({
      total: 500,
      averagePrice: 15_250,
      cheapest: 500,
      newest: new Date("2026-03-04Z"),
      topThree: 30_500,
      averageDollars: 152.5,
    });
    expect(groups).toEqual({
      byAvailability: new Map([
        [true, 1],
        [false, 1],
      ]),
      inStock: 1,
      valueByAvailability: new Map([
        [true, 500],
        [false, 30_000],
      ]),
      byBand: new Map([
        [[true, "cheap"], 1],
        [[false, "pricey"], 1],
      ]),
      crowdedCounts: new Map(),
    });
    expect(largest.size).toBe(1); // the two groups tie, so either
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

  test("unscoped() leaves the default scope out on Postgres", async () => {
    const everything = await withDatabase(connect(schema().url), () => scopes.unscoping());

    expect(everything.map((product) => product.name).sort((a, b) => a.localeCompare(b))).toEqual([
      "Ink",
      "Pen",
    ]);
  });
});

// The Joins page's examples, on the Postgres tables it shows.
describe("the Joins page's examples, on Postgres", () => {
  const schema = pageSchema(
    "joins",
    "INSERT INTO authors (id, name) VALUES ('00000000-0000-4000-8000-000000000001', 'Jane'), ('00000000-0000-4000-8000-000000000002', 'Sam');\nINSERT INTO profiles (id, author_id, bio) VALUES ('00000000-0000-4000-8000-000000000003', '00000000-0000-4000-8000-000000000001', 'Poet');\nINSERT INTO articles (id, author_id, title) VALUES ('00000000-0000-4000-8000-000000000004', '00000000-0000-4000-8000-000000000001', 'On Nothing'), ('00000000-0000-4000-8000-000000000005', '00000000-0000-4000-8000-000000000002', 'Engines');\nINSERT INTO comments (id, article_id, body) VALUES ('00000000-0000-4000-8000-000000000006', '00000000-0000-4000-8000-000000000004', 'Hm.'), ('00000000-0000-4000-8000-000000000007', '00000000-0000-4000-8000-000000000004', 'Yes.')",
  );

  test("joins, leftJoins and merge find the records they show", async () => {
    const db = connect(schema().url);

    const commented = await withDatabase(db, () => joins.joining());
    const everyAuthor = await withDatabase(db, () => joins.leftJoining());
    const { byAuthorName } = await withDatabase(db, () => joins.merging());

    expect(commented.map((author) => author.name)).toEqual(["Jane"]);
    expect(everyAuthor).toHaveLength(2);
    expect(byAuthorName.map((article) => article.title)).toEqual(["On Nothing", "Engines"]);
  });
});

// The Raw statements page's conversions, through pg on the Postgres table it shows.
describe("the Raw statements page's conversions, on Postgres", () => {
  const schema = pageSchema(
    "raw-statements",
    "INSERT INTO invoices (total, paid_at) VALUES (10, 1767225600), (20, 1767312000), (30, NULL)",
  );

  test("serialize's value binds as $1, and deserialize reads a BIGINT cell once it's a number", async () => {
    const { serialize, deserialize } = Invoice.typeForAttribute("paidAt");

    const { rows } = await schema().pool.query({
      text: "SELECT total, paid_at FROM invoices WHERE paid_at >= $1 ORDER BY id",
      values: [serialize(new Date("2026-01-02T00:00:00.000Z"))],
    });

    // pg reads a BIGINT cell as text; the adapter's own clients convert it, a raw query doesn't.
    expect(rows.map((row) => typeof row["paid_at"])).toEqual(["string"]);
    expect(() => deserialize(rows[0]!["paid_at"])).toThrow(TypeError);
    expect(rows.map((row) => [row["total"], deserialize(Number(row["paid_at"]))])).toEqual([
      [20, new Date("2026-01-02T00:00:00.000Z")],
    ]);
  });
});

// Each page shows its Models beside its Postgres tables, which generate the same attributes as its
// D1 ones. PGlite starts for each schema read, which takes seconds.
describe("the standalone pages' Postgres tables", { timeout: 60_000 }, () => {
  test.each(standalonePages)("%s's generate the attributes its D1 tables do", async (page) => {
    const cwd = await onPostgres(page, true);

    expect(generatedAttributes(cwd)).toEqual(generatedAttributes(pageProject(page).pathname));
  });
});
