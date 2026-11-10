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
import { gte, Model, withDatabase } from "../../../packages/active-record/src/index.ts";
import { connect } from "../../../packages/active-record/src/adapters/d1/index.ts";
import {
  Article,
  Author,
  autosaveExample,
  belongsToExample,
  createThroughExample,
  hasManyExample,
  hasOneExample,
  preloadExample,
  readExample,
  statementsExample,
  writersExample,
} from "../../../site/snippets/guide/associations.ts";
import * as batches from "../../../site/snippets/guide/batches.ts";
import { addExample, Booking, errorsExample } from "../../../site/snippets/guide/validations.ts";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runGenerate } from "../../../packages/active-record/cli/generate/command.ts";
import { runInit } from "../../../packages/active-record/cli/init/command.ts";
import { parseJsonc } from "../../../packages/active-record/cli/project/config-file.ts";
import { runSchema } from "../../../packages/active-record/cli/schema/command.ts";
import { Post, User } from "../../../site/snippets/getting-started/models.ts";
import * as models from "../../../site/snippets/guide/models.ts";
import { createdSince, oldestFirst, Reminder } from "../../../site/snippets/guide/mixed-dates.ts";
import { paidAt, paidSince } from "../../../site/snippets/guide/raw-statements.ts";
import * as untrusted from "../../../site/snippets/guide/untrusted-input.ts";
import * as paginating from "../../../site/snippets/guide/paginating.ts";
import * as filtering from "../../../site/snippets/guide/filtering.ts";
import * as hidden from "../../../site/snippets/guide/hidden-attributes.ts";
import { messagesExample, Product } from "../../../site/snippets/guide/error-messages.ts";
import worker from "../../../site/snippets/getting-started/src/index.ts";
import * as several from "../../../site/snippets/guide/several-databases.ts";
import { publishDraftsAndRemove } from "../../../site/snippets/getting-started/src/publish.ts";
import { createTestDatabase, recordingBatches, type TestDatabase } from "../../support/d1.ts";
import { scratchDirs } from "../../support/scratch.ts";

const scratch = scratchDirs();

// Inside a Worker, a Model's binding comes from cloudflare:workers; here, Miniflare's D1 stands in.
const workers: { env: Record<string, unknown> } = { env: {} };
vi.mock("cloudflare:workers", () => workers);

// The Getting started project: the generators' own output (its migrations, schema.ts and
// application-record.ts), with the tutorial's edits to the Models.
const gettingStarted = new URL("../../../site/snippets/getting-started/", import.meta.url);
const gettingStartedMigrations = [
  "20261108090503_create_users.sql",
  "20261108090504_create_posts.sql",
].map((file) => new URL(`migrations/${file}`, gettingStarted));

// The documentation's Getting started runs as written, on its own migrations.
describe("Getting started", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;
  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase(gettingStartedMigrations));
    workers.env = { DB: binding };
  });
  afterAll(() => dispose());

  test("its files are what the tutorial's init and two g model commands write, apart from its edit to user.ts", async () => {
    // Migrations are named for the UTC second they're written in, so the clock is set.
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-11-08T09:05:03Z"));
    onTestFinished(() => void vi.useRealTimers());
    // In the repo, so the Models g model writes find this repo's library, as an app's do.
    const fresh = scratch("getting-started-");
    writeFileSync(
      join(fresh, "wrangler.jsonc"),
      readFileSync(new URL("wrangler.jsonc", gettingStarted)),
    );
    const quiet = () => {};
    await runInit({ cwd: fresh }, quiet);
    await runGenerate(
      {
        cwd: fresh,
        kind: "model",
        name: "User",
        columns: ["email:string!:unique", "isActive:boolean!=true"],
      },
      quiet,
    );
    await runGenerate(
      {
        cwd: fresh,
        kind: "model",
        name: "Post",
        columns: ["user:references", "title:string!", "publishedAt:datetime"],
      },
      quiet,
    );

    for (const file of [
      "migrations/20261108090503_create_users.sql",
      "migrations/20261108090504_create_posts.sql",
      "src/db/schema.ts",
      "src/models/application-record.ts",
      "src/models/post.ts",
    ]) {
      expect([file, readFileSync(join(fresh, file), "utf8")]).toEqual([
        file,
        readFileSync(new URL(file, gettingStarted), "utf8"),
      ]);
    }
    // Its $schema links to the package in the app's node_modules; this one finds the repo's.
    const read = (path: string | URL) => ({
      ...(parseJsonc(readFileSync(path, "utf8")) as object),
      $schema: "…",
    });
    expect(read(join(fresh, "active-record.jsonc"))).toEqual(
      read(new URL("active-record.jsonc", gettingStarted)),
    );
  });

  test("its schema.ts is what its migrations generate", async () => {
    const output: string[] = [];

    expect(
      await runSchema({ cwd: gettingStarted.pathname, check: true }, (line) => output.push(line)),
    ).toBe(0);
  });

  function request(method: string, body?: unknown): Promise<Response> {
    const init = body === undefined ? { method } : { method, body: JSON.stringify(body) };
    return worker.fetch(new Request("https://example.com/", init));
  }

  test("POST signs up a user with a first post; a taken email is a 422 with its errors", async () => {
    const created = await request("POST", { email: "Ada@Example.com" });
    const again = await request("POST", { email: "ada@example.com" });

    expect(created.status).toBe(201);
    expect(await created.json()).toMatchObject({ email: "ada@example.com", isActive: true });
    expect(again.status).toBe(422);
    expect(await again.json()).toEqual({ errors: ["Email has already been taken"] });
  });

  test("GET lists active users, newest first, each with their posts", async () => {
    await request("POST", { email: "grace@example.com" });

    const users = (await (await request("GET")).json()) as { email: string }[];

    expect(users.map((user) => user.email)).toEqual(["grace@example.com", "ada@example.com"]);
    // Associations aren't part of toJSON(), so the posts were preloaded but not serialized.
    const db = connect(binding);
    const [grace] = await db
      .model(User)
      .where({ email: "grace@example.com" })
      .includes("posts")
      .toArray();
    expect(grace!.loaded("posts").map((post) => post.title)).toEqual(["Hello, world"]);
  });

  test("a batch publishes the drafts and destroys a user with their posts, atomically", async () => {
    const db = connect(binding);
    // Loaded as the example's statements are, on the current database, so they share a batch.
    const ada = await User.findByOrThrow({ email: "ada@example.com" });

    await publishDraftsAndRemove(ada);

    expect(await db.model(User).pluck("email")).toEqual(["grace@example.com"]);
    expect(await db.model(Post).where({ publishedAt: null }).count()).toBe(0);
    expect(await db.model(Post).count()).toBe(1);
  });

  test("Querying: the paginate examples page the posts, newest first", async () => {
    const db = connect(binding);
    const grace = await db.model(User).findByOrThrow({ email: "grace@example.com" });
    for (const day of [1, 2]) {
      const publishedAt = new Date(Date.UTC(2030, 0, day));
      await db.model(Post).create({ userId: grace.id, title: `Day ${day}`, publishedAt });
    }

    const response = await paginating.listPosts(new Request("https://example.com/?page=1"));
    const second = await withDatabase(db, paginating.countless);

    expect(await response.json()).toMatchObject({
      records: [{ title: "Day 2" }, { title: "Day 1" }, { title: "Hello, world" }],
      page: 1,
      perPage: 20,
      total: 3,
      totalPages: 1,
      hasNext: false,
      hasPrevious: false,
    });
    expect(second).toEqual({ records: [], hasNext: false });
    expect([paginating.Base.perPage, paginating.Base.maxPerPage]).toEqual([20, 50]);
  });
});

// The guide's larger examples, on the tables they're written for.
describe("the guide's examples", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;
  const schema = new URL("../../../site/snippets/guide/schema.sql", import.meta.url);

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase(schema));
  });
  afterAll(() => dispose());
  // The examples log what they show; the tests check it here rather than print it.
  const log = vi.spyOn(console, "log").mockImplementation(() => {});
  afterAll(() => log.mockRestore());
  beforeEach(async () => {
    log.mockClear();
    await binding.batch([
      binding.prepare("DELETE FROM comments"),
      binding.prepare("DELETE FROM profiles"),
      binding.prepare("DELETE FROM articles"),
      binding.prepare("DELETE FROM authors"),
      binding.prepare("INSERT INTO authors (id, name) VALUES ('mary', 'Mary')"),
      binding.prepare(
        "INSERT INTO articles (id, author_id, title, published, created_at) VALUES ('x1', 'mary', 'On Nothing', 1, '2026-01-01T00:00:00.000Z')",
      ),
      binding.prepare("INSERT INTO profiles (author_id, bio) VALUES ('mary', 'Poet')"),
      binding.prepare("INSERT INTO comments (article_id, body) VALUES ('x1', 'Hm.')"),
    ]);
  });

  test("Validations: the errors example has the five errors its comments show", async () => {
    const account = await withDatabase(connect(binding), () => errorsExample());

    expect(account.errors.fullMessages()).toEqual([
      "Email can't be blank",
      "Handle is too short (minimum is 3 characters)",
      "Handle is invalid",
      "Plan is not included in the list",
      "Seats is not a number",
    ]);
    expect(account.errors.toArray()[0]).toEqual({
      attribute: "email",
      type: "blank",
      message: "can't be blank",
    });
    expect(log).toHaveBeenCalledWith(5);
  });

  test("Validations: a custom rule added in afterValidation makes the record invalid", async () => {
    const at = new Date("2026-05-01T10:00:00Z");
    const booking = connect(binding).model(Booking).build({ startsAt: at, endsAt: at });

    expect(await booking.isValid()).toBe(false);
    expect(booking.errors.fullMessages()).toEqual(["Ends at must be after the start"]);
  });

  test("Validations: errors added in a callback read as the add example shows", async () => {
    const booking = await withDatabase(connect(binding), () => addExample());

    expect(booking.errors.toArray()).toEqual([
      { attribute: "endsAt", type: "afterStart", message: "must be after the start" },
      { attribute: "base", type: "invalid", message: "The room is closed on Sundays" },
    ]);
    expect(booking.errors.fullMessages()).toEqual([
      "Ends at must be after the start",
      "The room is closed on Sundays",
    ]);
  });

  test("Validations: changed messages read as the messages example shows", async () => {
    const product = await withDatabase(connect(binding), () => messagesExample());

    expect(product.errors.fullMessages()).toEqual([
      "Name needs a name customers will see",
      "Name needs at least 3 characters",
      "Price must be more than 0",
    ]);
    expect(Product.humanAttributeName("priceCents")).toBe("Price");
    expect(Product.humanAttributeName("createdAt")).toBe("Added on");
  });

  test("Associations: reading, creating through, and deleting through an association", async () => {
    const db = connect(binding);
    const { author, profile, latest } = await withDatabase(db, () => readExample("x1"));
    const comment = await withDatabase(db, () => createThroughExample("x1"));

    expect([author?.name, profile?.bio, latest?.title]).toEqual(["Mary", "Poet", "On Nothing"]);
    expect(comment.articleId).toBe("x1");

    await statementsExample(await db.model(Article).find("x1"));
    expect(
      await db
        .model(Article)
        .find("x1")
        .then((article) => article.comments().count()),
    ).toBe(0);
  });

  test("Associations: each kind's reference example, as the guide shows it", async () => {
    const db = connect(binding);
    const editor = await db.model(Author).createOrThrow({ name: "Ed" });

    const articles = await withDatabase(db, () => hasManyExample("mary")); // builds an Untitled one, then deletes it
    const author = await withDatabase(db, () => belongsToExample("x1", editor));
    const profile = await withDatabase(db, () => hasOneExample("mary"));

    expect(articles.map((article) => article.title)).toEqual(["On Nothing"]);
    expect(author?.name).toBe("Mary");
    expect(await db.model(Article).pluck("authorId", "title")).toEqual([[editor.id, "On Nothing"]]);
    expect(profile?.bio).toBe("Poet");
  });

  test("Associations: autosave writes the graph in one batch; set() links new and saved authors", async () => {
    const queries: string[] = [];
    const db = connect(binding, { onQuery: ({ sql }) => queries.push(sql) });
    const ada = await withDatabase(db, () => autosaveExample());
    const batched = queries.length;
    const { draft, another, grace } = await withDatabase(db, () => writersExample(ada));

    expect(batched).toBe(4); // the author, two articles and the profile (atomicity: autosave tests)
    expect(await db.model(Article).where({ authorId: ada.id }).pluck("title")).toEqual(
      expect.arrayContaining([
        "Notes on the Analytical Engine",
        "Sketch of the Engine",
        "Untitled",
      ]),
    );
    expect((await ada.profile())?.bio).toBe("Mathematician");
    expect(draft.authorId).toBe(ada.id);
    expect(grace.isPersisted()).toBe(true);
    expect(another.authorId).toBe(grace.id);
  });

  test("Associations: the preload takes 4 queries in 1 round trip, and the loop none", async () => {
    await withDatabase(connect(binding), () => autosaveExample());
    const queries: string[] = [];
    const recording = recordingBatches(binding);

    const authors = await withDatabase(
      connect(recording.binding, { onQuery: ({ sql }) => queries.push(sql) }),
      () => preloadExample(),
    );

    expect(authors.map((author) => author.name).sort()).toEqual(["Ada", "Mary"]);
    // The authors, profiles, articles and comments, all in one batch.
    expect(queries).toHaveLength(4);
    expect(recording.batches).toEqual([4]);
    expect(log).toHaveBeenCalledWith("Mary", 1, "Poet");
    expect(log).toHaveBeenCalledWith("Ada", 2, "Mathematician");
  });

  test("Batches: statements, many rows, an atomic batch, and records in a batch", async () => {
    const db = connect(binding);

    const commentId = await withDatabase(db, () => batches.statementsExample("x1"));
    await withDatabase(db, () => batches.insertAllExample("x1"));
    const returned = await withDatabase(db, () => batches.returningExample("x1"));
    const graceId = await withDatabase(db, () => batches.batchExample());

    expect(commentId).toEqual(expect.any(Number));
    expect(log).toHaveBeenCalledWith(1, 1, commentId); // the article's one comment deleted
    expect(new Set(returned.map(({ body }) => body))).toEqual(new Set(["One", "Two"]));
    for (const { id, body } of returned) expect(log).toHaveBeenCalledWith(id, body);
    expect(
      await db
        .model(Article)
        .find("x1")
        .then((article) => article.title),
    ).toBe("EDITED");
    expect(
      await db
        .model(Author)
        .find("author-1")
        .then((author) => author.name),
    ).toBe("Ada");
    expect(await db.model(Article).where({ authorId: graceId }).pluck("title")).toEqual(["Hello"]);

    const { savedAuthor } = await withDatabase(db, () => batches.recordsExample("x1", graceId));

    expect(savedAuthor.isPersisted()).toBe(true);
    expect(
      await db
        .model(Article)
        .find("x1")
        .then((article) => article.title),
    ).toBe("Final");
    expect(await db.model(Author).exists({ id: graceId })).toBe(false); // and its article, dependent
    expect(await db.model(Article).where({ authorId: graceId }).count()).toBe(0);
    expect(
      await db
        .model(Article)
        .find("x1")
        .then((article) => article.comments().count()),
    ).toBe(0);
  });
});

// Change a table: code deployed before a migration adds a column keeps working.
describe("Change a table", () => {
  test("code that doesn't declare a newer column keeps working, as the guide says", async () => {
    const { db: binding, dispose } = await createTestDatabase(gettingStartedMigrations);
    await binding.prepare("ALTER TABLE users ADD COLUMN bio TEXT").run();
    await binding
      .prepare(
        "INSERT INTO users (id, email, bio, created_at, updated_at) VALUES ('u1', 'a@example.com', 'hi', '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')",
      )
      .run();
    // The User of Getting started, deployed before the migration: no bio attribute.
    const db = connect(binding);
    const user = await db.model(User).find("u1");

    user.email = "b@example.com";
    await user.save();
    await user.reload();
    const created = await db.model(User).create({ email: "c@example.com" });

    expect(user.email).toBe("b@example.com");
    expect(created.isPersisted()).toBe(true);
    expect(JSON.stringify(user)).not.toContain("bio");
    await dispose();
  });
});

describe("Models: assigned values are cast", () => {
  test("the example casts as its comments say, then throws the TypeError it shows", () => {
    // Building and assigning send nothing, so no database is needed.
    const user = connect({} as never)
      .model(models.User)
      .build({ email: "ada@example.com" });
    const log = vi.spyOn(console, "log").mockImplementation(() => {});

    expect(() => models.castingExample(user)).toThrow(
      new TypeError('User: "no" isn\'t a boolean for "isActive"'),
    );
    expect(log.mock.calls).toEqual([[false], [42]]);
    log.mockRestore();
  });
});

// Handle untrusted input: each example keeps out what it says it does.
describe("Handle untrusted input", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;
  const schema = new URL("../../../site/snippets/guide/schema.sql", import.meta.url);
  const json = (body: unknown) =>
    new Request("https://example.com/", { method: "POST", body: JSON.stringify(body) });
  const run = <T>(fn: () => Promise<T>) => withDatabase(connect(binding), fn);

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase(schema));
  });
  afterAll(() => dispose());
  beforeEach(async () => {
    await binding.batch([
      binding.prepare("DELETE FROM accounts"),
      binding.prepare("DELETE FROM invitations"),
      binding.prepare(
        "INSERT INTO invitations (id, email, token, accepted_at) VALUES (1, 'ada@example.com', NULL, '2026-01-01T00:00:00.000Z'), (2, 'grace@example.com', 'k3y', NULL)",
      ),
    ]);
  });

  test("permit keeps the fields it names, and the record saves them", async () => {
    const account = await run(() =>
      untrusted.signUp(json({ email: "ada@example.com", handle: "ada", plan: "pro" })),
    );

    expect([account.email, account.handle, account.plan]).toEqual(["ada@example.com", "ada", null]);
  });

  test("a value that can't be used, or a body that isn't JSON, is a 400; a valid one saves", async () => {
    const account = await run(() =>
      untrusted.Account.create({ email: "ada@example.com", handle: "ada" }),
    );
    const raw = (body: string) => new Request("https://example.com/", { method: "POST", body });

    expect(
      (await run(() => untrusted.updateAccount(account, json({ seats: "many" })))).status,
    ).toBe(400);
    expect((await run(() => untrusted.updateAccount(account, raw("{nope")))).status).toBe(400);
    expect((await run(() => untrusted.updateAccount(account, json(["seats"])))).status).toBe(400);

    const saved = await run(() => untrusted.updateAccount(account, json({ seats: "3" })));
    expect([saved.status, account.seats]).toEqual([200, 3]);
  });

  test("an untrusted null never reaches the query, so an accepted invitation stays accepted", async () => {
    for (const token of [null, [null], ""]) {
      expect((await run(() => untrusted.accept(json({ token })))).status).toBe(400);
    }
    expect((await run(() => untrusted.accept(json({ token: "nope" })))).status).toBe(404);

    const accepted = await run(() => untrusted.accept(json({ token: "k3y" })));
    expect(await accepted.text()).toBe("Welcome, grace@example.com");
  });
});

describe("Log queries: keep secrets out of the logs", () => {
  test("the base class adds to Rails' defaults", () => {
    expect(filtering.Base.filterAttributes).toEqual([
      ...Model.filterAttributes,
      "iban",
      /^dateOfBirth$/,
    ]);
  });
});

describe("Serialize records: hide attributes from toJSON", () => {
  test("a Model adds to the base class's list", () => {
    expect(hidden.Base.hiddenAttributes).toEqual(["passwordDigest"]);
    expect(hidden.Account.hiddenAttributes).toEqual(["passwordDigest", "apiKey"]);
  });
});

describe("Existing databases: a column holding two date forms", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;
  const schema = new URL("../../../site/snippets/guide/mixed-dates.sql", import.meta.url);
  const normalize = new URL(
    "../../../site/snippets/guide/mixed-dates-normalize.sql",
    import.meta.url,
  );
  const since = new Date("2026-10-12T00:00:00.000Z");

  // One row of each form, and one from the day before.
  const rows = [
    "INSERT INTO reminders VALUES (1, 'default form', '2026-10-12 23:59:59')",
    "INSERT INTO reminders VALUES (2, 'iso form', '2026-10-12T00:00:00.000+00:00')",
    "INSERT INTO reminders VALUES (3, 'earlier', '2026-10-11 08:00:00')",
  ];

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase(schema));
  });
  afterAll(() => dispose());
  beforeEach(async () => {
    await binding.batch([
      binding.prepare("DELETE FROM reminders"),
      ...rows.map((row) => binding.prepare(row)),
    ]);
  });

  const inDatabase = <T>(run: () => Promise<T>) => withDatabase(connect(binding), run);
  const names = (reminders: { name: string }[]) => reminders.map((reminder) => reminder.name);

  test("a plain comparison orders them as text, so it misses both of the day's rows", async () => {
    const reminders = await inDatabase(() => Reminder.where({ createdAt: gte(since) }).toArray());

    expect(names(reminders)).toEqual([]);
  });

  test("the strftime recipe compares them as times", async () => {
    const reminders = await inDatabase(() => createdSince(since).toArray());

    expect(names(reminders).sort((a, b) => a.localeCompare(b))).toEqual([
      "default form",
      "iso form",
    ]);
  });

  test("a plain order sorts the two forms as text, so a later row comes first", async () => {
    const reminders = await inDatabase(() => Reminder.order({ createdAt: "asc" }).toArray());

    expect(names(reminders)).toEqual(["earlier", "default form", "iso form"]);
  });

  test("the strftime order sorts them as times", async () => {
    const reminders = await inDatabase(() => oldestFirst().toArray());

    expect(names(reminders)).toEqual(["earlier", "iso form", "default form"]);
  });

  test("after the migration, a plain comparison and order are right, in one form", async () => {
    await binding.prepare(readFileSync(normalize, "utf8")).run();

    const found = await inDatabase(() => Reminder.where({ createdAt: gte(since) }).toArray());
    const ordered = await inDatabase(() => Reminder.order({ createdAt: "asc" }).toArray());
    const stored = (await binding.prepare("SELECT created_at FROM reminders ORDER BY id").all())
      .results;

    expect(names(found).sort((a, b) => a.localeCompare(b))).toEqual(["default form", "iso form"]);
    expect(names(ordered)).toEqual(["earlier", "iso form", "default form"]);
    expect(stored).toEqual([
      { created_at: "2026-10-12T23:59:59.000Z" },
      { created_at: "2026-10-12T00:00:00.000Z" },
      { created_at: "2026-10-11T08:00:00.000Z" },
    ]);
  });
});

describe("Querying: raw statements bind and read a value as the attribute stores it", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;
  const schema = new URL("../../../site/snippets/guide/raw-statements.sql", import.meta.url);

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase(schema));
    await binding.batch([
      binding.prepare("INSERT INTO invoices VALUES (1, 10, 1767225600)"), // 2026-01-01
      binding.prepare("INSERT INTO invoices VALUES (2, 20, 1767312000)"), // 2026-01-02
      binding.prepare("INSERT INTO invoices VALUES (3, 30, NULL)"),
    ]);
  });
  afterAll(() => dispose());

  test("serialize binds the integer the column holds, so the comparison works", async () => {
    const rows = await paidSince(binding, new Date("2026-01-02T00:00:00.000Z"));

    expect(rows).toEqual([{ id: 2, total: 20 }]);
  });

  test("deserialize reads the cell as a Date", async () => {
    expect(await paidAt(binding, 1)).toEqual(new Date("2026-01-01T00:00:00.000Z"));
  });

  test("deserialize reads NULL as null", async () => {
    expect(await paidAt(binding, 3)).toBeNull();
  });
});

describe("Multiple databases: each Model on its own binding", () => {
  let db: TestDatabase;
  let logs: TestDatabase;
  let disposeAll: () => Promise<void>;
  const sql = (name: string) =>
    new URL(`../../../site/snippets/guide/${name}.sql`, import.meta.url);

  beforeAll(async () => {
    const [main, second] = await Promise.all([
      createTestDatabase(sql("several-databases-db")),
      createTestDatabase(sql("several-databases-logs")),
    ]);
    ({ db } = main);
    ({ db: logs } = second);
    disposeAll = async () => {
      await Promise.all([main.dispose(), second.dispose()]);
    };
  });
  afterAll(() => disposeAll());
  beforeEach(async () => {
    await db.prepare("DELETE FROM users").run();
    await logs.prepare("DELETE FROM entries").run();
    // The library reads cloudflare:workers' env once, so this changes that object, not replaces it.
    Object.assign(workers.env, { DB: db, LOGS: logs });
  });

  const messages = async () =>
    (await logs.prepare("SELECT message FROM entries ORDER BY id").all()).results;
  const env = () => workers.env as Parameters<typeof several.replicas.fetch>[1];

  test("a request reads a user from DB and logs an entry on LOGS", async () => {
    await db.prepare("INSERT INTO users VALUES (1, 'ada@example.com')").run();
    const request = new Request("https://example.com/?email=ada@example.com");
    const response = await several.default.fetch(request, env());

    expect(await response.json()).toMatchObject({ email: "ada@example.com" });
    expect(await messages()).toEqual([{ message: "ada@example.com signed in" }]);
  });

  test("signUp writes the user first, so a refused user logs nothing", async () => {
    await several.signUp("ada@example.com");
    await expect(several.signUp("ada@example.com")).rejects.toThrow();

    expect(await messages()).toEqual([{ message: "ada@example.com signed up" }]);
  });

  test("nested withSession calls carry each database's bookmark in its own cookie", async () => {
    const request = new Request("https://example.com/?email=ada@example.com");
    const response = await several.replicas.fetch(request, env());

    expect(response.headers.getSetCookie()).toEqual([
      expect.stringMatching(/^logs-bookmark=/),
      expect.stringMatching(/^d1-bookmark=/),
    ]);
    expect((await db.prepare("SELECT email FROM users").all()).results).toEqual([
      { email: "ada@example.com" },
    ]);
    expect(await messages()).toEqual([{ message: "ada@example.com signed up" }]);
  });
});
