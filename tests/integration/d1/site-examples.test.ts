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
import { gte, withDatabase } from "../../../packages/active-record/src/index.ts";
import { connect } from "../../../packages/active-record/src/adapters/d1/index.ts";
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { runGenerate } from "../../../packages/active-record/cli/generate/command.ts";
import { runInit } from "../../../packages/active-record/cli/init/command.ts";
import { parseJsonc } from "../../../packages/active-record/cli/project/config-file.ts";
import { runSchema } from "../../../packages/active-record/cli/schema/command.ts";
import { Post, User } from "../../../site/snippets/getting-started/models.ts";
import { createdSince, oldestFirst, Reminder } from "../../../site/snippets/guide/mixed-dates.ts";
import worker from "../../../site/snippets/getting-started/src/index.ts";
import * as several from "../../../site/snippets/guide/several-databases.ts";
import { publishDraftsAndRemove } from "../../../site/snippets/getting-started/src/publish.ts";
import { createTestDatabase, type TestDatabase } from "../../support/d1.ts";
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
});

// The guide's larger examples, on the tables they're written for.
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

  test("a user's entries are read from LOGS", async () => {
    await db.prepare("INSERT INTO users VALUES (1, 'ada@example.com')").run();
    await logs
      .prepare("INSERT INTO entries (user_id, level, message) VALUES (1, 'error', 'failed')")
      .run();

    const errors = await several.errorEntriesOf(1);

    expect(errors.map((entry) => entry.message)).toEqual(["failed"]);
  });

  test("entries preload their users from DB", async () => {
    await db.prepare("INSERT INTO users VALUES (1, 'ada@example.com')").run();
    await logs
      .prepare("INSERT INTO entries (user_id, level, message) VALUES (1, 'info', 'hello')")
      .run();

    const [entry] = await several.entriesWithUsers();

    expect(entry!.loaded("user")?.email).toBe("ada@example.com");
  });

  test("an entry created through a user is written to LOGS with the user's key", async () => {
    await db.prepare("INSERT INTO users VALUES (7, 'ada@example.com')").run();

    await several.logFor(await several.User.find(7), "hello");

    expect((await logs.prepare("SELECT user_id, message FROM entries").all()).results).toEqual([
      { user_id: 7, message: "hello" },
    ]);
  });

  test("a user saved with a built entry writes the entry to LOGS with its new key", async () => {
    const user = await several.signUpWithEntry("ada@example.com");

    expect((await logs.prepare("SELECT user_id FROM entries").all()).results).toEqual([
      { user_id: user.id },
    ]);
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
