import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { connect, type QueryEvent } from "../../packages/d1-record/src/index.ts";
import { Post } from "../fixtures/models/post.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

/**
 * 50 posts, titled so that ordering by title reverses their ids; `title` has no index. Only
 * posts 1 to 10 have a `createdAt`, so which rows a limit keeps changes `count("createdAt")`.
 */
const POSTS = 50;

describe("an order that can't change the answer isn't sent (#215)", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;
  const events: QueryEvent[] = [];
  const db = () => connect(binding, { onQuery: (event) => events.push(event) });
  const ordered = () => db().model(Post).order({ title: "asc" });
  /** The rows D1 read for the statements since the last reset. */
  const rowsRead = () => events.reduce((sum, event) => sum + (event.meta?.rows_read ?? 0), 0);

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
    await binding.batch([
      binding.prepare("INSERT INTO users (id, email) VALUES (1, 'a@example.com')"),
      binding
        .prepare(
          "INSERT INTO posts (id, user_id, title) SELECT value, 1, printf('Post %02d', ? - value) FROM json_each(?)",
        )
        .bind(POSTS, JSON.stringify(Array.from({ length: POSTS }, (_, index) => index + 1))),
      binding.prepare("UPDATE posts SET created_at = '2026-01-01T00:00:00.000Z' WHERE id <= 10"),
    ]);
  });
  afterAll(() => dispose());
  beforeEach(() => {
    events.length = 0;
  });

  test("exists() on an ordered Relation reads one row", async () => {
    expect(await ordered().exists()).toBe(true);
    expect(rowsRead()).toBe(1);
  });

  test("isEmpty() and hasAny() on an ordered Relation read one row each", async () => {
    expect([await ordered().isEmpty(), await ordered().hasAny()]).toEqual([false, true]);
    expect(rowsRead()).toBe(2);
  });

  test("exists() past an offset reads only up to the offset, ascending or descending", async () => {
    expect(await ordered().offset(10).exists()).toBe(true);
    expect(rowsRead()).toBe(11);

    events.length = 0;
    expect(await db().model(Post).order({ title: "desc" }).offset(10).exists()).toBe(true);
    expect(rowsRead()).toBe(11);
  });

  test("count() on an ordered Relation reads each row once, with no sort", async () => {
    expect(await ordered().count()).toBe(POSTS);
    expect(rowsRead()).toBe(POSTS);
  });

  test("count(attribute) on an ordered Relation reads each row once, with no sort", async () => {
    expect(await ordered().count("createdAt")).toBe(10);
    expect(rowsRead()).toBe(POSTS);
  });

  test("paginate()'s count reads each row once, and its page keeps the order", async () => {
    const page = await ordered().paginate({ perPage: 10 });

    expect(page.total).toBe(POSTS);
    expect(page.records.map((post) => post.title).slice(0, 2)).toEqual(["Post 00", "Post 01"]);
    const count = events.find((event) => event.sql.startsWith("SELECT COUNT"));
    expect(count?.meta?.rows_read).toBe(POSTS);
  });
});

describe("exists() with distinct() and an offset reads the rows toArray() would (#222)", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;
  const events: QueryEvent[] = [];
  const posts = () => connect(binding, { onQuery: (event) => events.push(event) }).model(Post);
  const titles = () => posts().select("title");

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
    await binding.batch([
      binding.prepare("INSERT INTO users (id, email) VALUES (1, 'a@example.com')"),
      binding.prepare(
        "INSERT INTO posts (id, user_id, title) VALUES (1, 1, 'A'), (2, 1, 'B'), (3, 1, 'B')",
      ),
    ]);
  });
  afterAll(() => dispose());

  // SQL text, though not a safety property: #222 asks that every other Relation's exists() send
  // the same SQL as before, and the rows D1 reads can't tell the two queries apart.
  test("without both distinct() and an offset, it still sends SELECT 1", async () => {
    events.length = 0;
    await titles().offset(1).exists();
    await titles().distinct().exists();

    expect(events.map((event) => event.sql)).toEqual([
      'SELECT 1 FROM "posts" LIMIT ? OFFSET ?',
      'SELECT DISTINCT 1 FROM "posts" LIMIT ?',
    ]);
  });
});
