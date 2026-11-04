import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { column, sql } from "../../src/index.ts";
import { Post } from "../fixtures/models/post.ts";
import { openHarness, type Harness } from "../support/harness.ts";

/**
 * 50 posts, titled so that ordering by title reverses their ids; `title` has no index. Only
 * posts 1 to 10 have a `createdAt`, so which rows a limit keeps changes `count("createdAt")`.
 */
const POSTS = 50;

describe("an order that can't change the answer isn't sent (#215)", () => {
  let harness: Harness;
  const db = () => harness.connect();
  const ordered = () => db().model(Post).order({ title: "asc" });

  beforeAll(async () => {
    harness = await openHarness();
    await harness.exec("INSERT INTO users (id, email) VALUES (1, 'a@example.com')");
    for (let id = 1; id <= POSTS; id++) {
      const title = `Post ${String(POSTS - id).padStart(2, "0")}`;
      await harness.exec("INSERT INTO posts (id, user_id, title) VALUES (?, 1, ?)", [id, title]);
    }
    await harness.exec("UPDATE posts SET created_at = '2026-01-01T00:00:00.000Z' WHERE id <= 10");
  });
  afterAll(() => harness.dispose());

  test("exists() finds the last row, and nothing past it, with or without a limit", async () => {
    expect(await ordered().offset(POSTS).exists()).toBe(false);
    expect(
      await ordered()
        .limit(5)
        .offset(POSTS - 1)
        .exists(),
    ).toBe(true);
  });

  test("with a limit, count(attribute) counts the rows the order picks", async () => {
    // Ascending titles start at post 50, so the first five have no createdAt; descending, post 1.
    expect(await ordered().limit(5).count("createdAt")).toBe(0);
    expect(await db().model(Post).order({ title: "desc" }).limit(5).count("createdAt")).toBe(5);
  });

  test("with only an offset, count(attribute) counts the rows the order picks", async () => {
    // Ascending, the last five are posts 5 to 1, which have a createdAt; descending, 46 to 50.
    expect(
      await ordered()
        .offset(POSTS - 5)
        .count("createdAt"),
    ).toBe(5);
    expect(
      await db()
        .model(Post)
        .order({ title: "desc" })
        .offset(POSTS - 5)
        .count("createdAt"),
    ).toBe(0);
  });

  test("an sql order with bound values is left out with its values, and kept with them", async () => {
    const third = db()
      .model(Post)
      .where(sql`${column("id")} <= ${20}`)
      .order(sql`CASE WHEN ${column("id")} = ${column("id").value(3)} THEN 0 ELSE 1 END`);

    expect([await third.exists(), await third.count()]).toEqual([true, 20]);
    expect(await third.limit(1).count()).toBe(1);
    expect((await third.limit(1).toArray()).map((post) => post.id)).toEqual([3]);
  });
});

describe("exists() with distinct() and an offset reads the rows toArray() would (#222)", () => {
  let harness: Harness;
  const posts = () => harness.connect().model(Post);
  const titles = () => posts().select("title");

  beforeAll(async () => {
    harness = await openHarness();
    await harness.exec("INSERT INTO users (id, email) VALUES (1, 'a@example.com')");
    await harness.exec(
      "INSERT INTO posts (id, user_id, title) VALUES (1, 1, 'A'), (2, 1, 'B'), (3, 1, 'B')",
    );
  });
  afterAll(() => harness.dispose());

  test("a distinct select past an offset finds the distinct rows left", async () => {
    const pastFirst = titles().distinct().offset(1);

    expect(await pastFirst.exists()).toBe(true);
    expect([await pastFirst.isEmpty(), await pastFirst.hasAny()]).toEqual([false, true]);
  });

  test("distinct() without a select treats whole rows as distinct", async () => {
    expect(await posts().distinct().offset(1).exists()).toBe(true);
    expect(await posts().distinct().offset(3).exists()).toBe(false);
  });

  test("past the last distinct row, there are none", async () => {
    expect(await titles().distinct().offset(2).exists()).toBe(false);
    expect(await titles().distinct().offset(2).isEmpty()).toBe(true);
  });

  test("with a limit and an offset, it finds the distinct row left, and none past it", async () => {
    expect(await titles().distinct().limit(1).offset(1).exists()).toBe(true);
    expect(await titles().distinct().limit(5).offset(2).exists()).toBe(false);
  });

  test("exists(conditions) applies them before the distinct rows and the offset", async () => {
    const pastFirst = titles().distinct().offset(1);

    expect(await pastFirst.exists({ title: "B" })).toBe(false);
    expect(await pastFirst.where({ title: "B" }).toArray()).toEqual([]);
    expect(await pastFirst.exists({ title: ["A", "B"] })).toBe(true);
  });

  // SQL text, though not a safety property: #222 asks that every other Relation's exists() send
  // the same SQL as before, and the rows D1 reads can't tell the two queries apart.
});
