import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  CheckViolation,
  hasMany,
  hasOne,
  InvalidForeignKey,
  Model,
  NotNullViolation,
  RecordNotUnique,
} from "../../packages/active-record/src/index.ts";
import { connect, type QueryEvent, withSession } from "../../packages/d1-record/src/index.ts";
import { configured, remoteDatabase, type RemoteDatabase } from "./support.ts";

/** The fixture Models, on this run's prefixed tables. */
function modelsFor(prefix: string) {
  class User extends Model.define({
    id: { type: "integer", null: false },
    email: { type: "string", null: false },
    role: "string",
    settings: "json",
    createdAt: "datetime",
    updatedAt: "datetime",
  }) {
    static table = `${prefix}users`;

    posts = hasMany(Post, { foreignKey: "userId" });
    firstPost = hasOne(Post, { foreignKey: "userId" });
  }

  class Post extends Model.define({
    id: { type: "integer", null: false },
    userId: { type: "integer", null: false },
    title: { type: "string", null: false },
    published: { type: "boolean", null: false },
    views: { type: "integer", null: false },
  }) {
    static table = `${prefix}posts`;
  }

  return { User, Post };
}

// Against a real remote D1: catches what Miniflare's local D1 can't show, such as error message
// formats, `meta` fields, D1's limits and Sessions. Skipped unless configured (see support.ts).
describe.skipIf(!configured)("remote D1 smoke", () => {
  let remote: RemoteDatabase;
  let User: ReturnType<typeof modelsFor>["User"];
  let Post: ReturnType<typeof modelsFor>["Post"];

  beforeAll(async () => {
    remote = await remoteDatabase();
    ({ User, Post } = modelsFor(remote.prefix));
  });
  afterAll(() => remote?.dispose());
  beforeEach(async () => {
    const db = connect(remote.binding);
    await db.batch([db.model(Post).toDeleteAll(), db.model(User).toDeleteAll()]);
  });

  test("create, find, update and destroy a record, with values converted both ways", async () => {
    const db = connect(remote.binding);
    const created = await db
      .model(User)
      .createOrThrow({ email: "a@example.com", settings: { theme: "dark" } });

    const found = await db.model(User).find(created.id);
    expect(found.settings).toEqual({ theme: "dark" });
    expect(found.createdAt).toBeInstanceOf(Date);

    await found.updateOrThrow({ role: "admin" });
    expect((await db.model(User).find(created.id)).role).toBe("admin");

    await found.destroyOrThrow();
    expect(await db.model(User).count()).toBe(0);
  });

  test("onQuery and insert get D1's meta, with the fields the contract relies on", async () => {
    const events: QueryEvent[] = [];
    const db = connect(remote.binding, { onQuery: (event) => events.push(event) });

    const result = await db.model(User).insert({ id: 1, email: "a@example.com" });

    expect(result).toEqual({ rowsAffected: 1, rows: [{ id: 1 }] });
    expect(events).toHaveLength(1);
    expect(events[0]?.meta).toMatchObject({ changes: 1, last_row_id: 1 });
    expect(typeof events[0]?.meta?.duration).toBe("number");
  });

  describe("constraint errors: D1's message formats", () => {
    test("UNIQUE names the table, column and attribute", async () => {
      const users = connect(remote.binding).model(User);
      await users.createOrThrow({ email: "a@example.com" });

      const error: unknown = await users
        .createOrThrow({ email: "a@example.com" })
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(RecordNotUnique);
      expect(error).toMatchObject({
        table: `${remote.prefix}users`,
        columns: ["email"],
        attributes: ["email"],
      });
    });

    test("NOT NULL, FOREIGN KEY and CHECK", async () => {
      const db = connect(remote.binding);
      const user = await db.model(User).createOrThrow({ email: "a@example.com" });

      // One at a time: each insert runs when called.
      await expect(
        db.model(Post).insert({ userId: user.id, title: null as never }),
      ).rejects.toThrow(NotNullViolation);
      await expect(db.model(Post).insert({ userId: 999_999, title: "Orphan" })).rejects.toThrow(
        InvalidForeignKey,
      );
      await expect(
        db.model(Post).insert({ userId: user.id, title: "Hello", views: -1 }),
      ).rejects.toThrow(CheckViolation);
    });
  });

  test("a failing batch rolls back completely", async () => {
    const db = connect(remote.binding);

    const error: unknown = await db
      .batch([
        db.model(User).toInsert({ id: 1, email: "a@example.com" }),
        db.model(Post).toInsert({ userId: 1, title: "Hello" }),
        db.model(User).toInsert({ id: 2, email: "a@example.com" }),
      ])
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RecordNotUnique);
    expect(await db.model(User).count()).toBe(0);
    expect(await db.model(Post).count()).toBe(0);
  });

  // With read replication on (see docs/agents/remote-smoke.md), "first-unconstrained" lets reads
  // go to a replica, so only the Session keeps them consistent with the writes.
  test("a session reads its own writes, and its bookmark carries them to the next request", async () => {
    const first = connect(remote.binding, { session: "first-unconstrained" });
    const user = await first.model(User).createOrThrow({ email: "a@example.com" });
    await user.updateOrThrow({ role: "admin" });
    await user.reload();
    expect(user.role).toBe("admin");

    const bookmark = first.bookmark();
    expect(typeof bookmark).toBe("string");

    const next = connect(remote.binding, { session: bookmark! });
    // Starting from the bookmark, a replica read waits until it has caught up with the write.
    expect((await next.model(User).find(user.id)).role).toBe("admin");
  });

  // A bookmark arrives in a cookie or a header, so a request can carry one D1 can't use: garbage,
  // a far-future one shaped like D1's, or a very long value. D1 rejects each on the Session's
  // first statement, and the request should still be answered, with a bookmark D1 made (#237).
  test.each([
    ["garbage", () => "not-a-bookmark"],
    [
      "a far-future one shaped like D1's",
      (real: string) => real.replace(/^[^-]+-[^-]+-[^-]+/, "7fffffff-7fffffff-7fffffff"),
    ],
    ["a very long value", () => "x".repeat(10_000)],
  ])(
    "a request with %s as its bookmark is answered, with a bookmark from D1",
    async (_, bookmarkFrom) => {
      const real = connect(remote.binding, { session: "first-unconstrained" });
      await real.model(User).count();
      const bookmark = bookmarkFrom(real.bookmark()!);
      const request = new Request("https://example.com/", {
        headers: { cookie: `d1-bookmark=${bookmark}` },
      });

      const answered = withSession(request, remote.binding, async (db) =>
        Response.json({ users: await db.model(User).count() }),
      );
      // A replica waiting for a commit that never comes would hang: report that, not a timeout.
      const outcome = await Promise.race([
        answered.then(
          (response) => ({ answered: response.status, cookie: response.headers.get("set-cookie") }),
          (error: unknown) => ({ threw: String(error) }),
        ),
        new Promise((resolve) =>
          setTimeout(() => resolve({ hung: "no answer after 20 s" }), 20_000),
        ),
      ]);

      expect(outcome).toEqual({
        answered: 200,
        cookie: expect.not.stringContaining(bookmark.slice(0, 40)),
      });
    },
    60_000,
  );

  // A preload's associations go as one batch (#92), which must go through the Session too.
  test("a session's preload batch reads its own writes", async () => {
    const db = connect(remote.binding, { session: "first-unconstrained" });
    const user = await db.model(User).createOrThrow({ email: "a@example.com" });
    await db.model(Post).insert({ userId: user.id, title: "Hello", published: true, views: 0 });

    const [loaded] = await db.model(User).includes("posts", "firstPost").toArray();

    expect(loaded?.loaded("posts").map((post) => post.title)).toEqual(["Hello"]);
    expect(loaded?.loaded("firstPost")?.title).toBe("Hello");
  });

  test("insertAll binds its rows as one JSON value, and upsert updates on conflict", async () => {
    const db = connect(remote.binding);
    const users = db.model(User);

    await users.insertAll([
      { id: 1, email: "a@example.com", settings: { theme: "dark" } },
      { id: 2, email: "b@example.com", settings: null },
    ]);
    await users.upsertAll([{ id: 1, email: "a@example.com", role: "admin" }]);
    const skipped = await users.insert({ id: 2, email: "b@example.com" }, { onDuplicate: "skip" });

    expect(skipped).toEqual({ rowsAffected: 0, rows: [] });
    expect(await users.order({ id: "asc" }).pluck("role", "settings")).toEqual([
      ["admin", { theme: "dark" }],
      [null, null],
    ]);
  });

  test("a record batch loads each new record's generated key from the batch's RETURNING rows", async () => {
    const db = connect(remote.binding);
    const first = db.model(User).build({ email: "a@example.com" });
    const second = db.model(User).build({ email: "b@example.com" });

    await db.batch([first.toSave(), second.toSave()]);

    expect([first.isPersisted(), second.isPersisted()]).toEqual([true, true]);
    expect(first.id).not.toBe(second.id);
    expect((await db.model(User).find(second.id)).email).toBe("b@example.com");
  });

  test("lists and preloads of more than 100 keys stay within D1's 100 bound parameters", async () => {
    const db = connect(remote.binding);
    const ids = Array.from({ length: 150 }, (_, index) => index + 1);
    // In batches of 25, under D1's per-invocation query limit (50 on the Free plan).
    for (let start = 0; start < ids.length; start += 25) {
      const group = ids.slice(start, start + 25);
      await db.batch(
        group.map((id) => db.model(User).toInsert({ id, email: `u${id}@example.com` })),
      );
      await db.batch(
        group.map((id) => db.model(Post).toInsert({ userId: id, title: `Post ${id}` })),
      );
    }

    // A 150-value list is one bound value (json_each), well within D1's 100-parameter limit.
    expect(await db.model(User).where({ id: ids }).count()).toBe(150);
    const users = await db.model(User).includes("posts").toArray();

    expect(users).toHaveLength(150);
    expect(users.every((user) => user.loaded("posts").length === 1)).toBe(true);
  });
});
