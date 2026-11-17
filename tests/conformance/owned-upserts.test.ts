import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { batch, belongsTo, hasMany, Model } from "../../packages/active-record/src/index.ts";
import { openHarness, type Harness } from "../support/harness.ts";

type Database = ReturnType<Harness["connect"]>;

class User extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
}) {
  static table = "users";

  posts = hasMany(Post);
}

class Post extends Model.define({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
}) {
  static table = "posts";

  author = belongsTo(User, { foreignKey: "userId" });
}

describe("upserting through an owner's hasMany (#451)", () => {
  let harness: Harness;
  const db = () => harness.connect();
  const posts = () => harness.exec("SELECT id, user_id, title FROM posts ORDER BY id");

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.reset("posts", "users");
    await harness.exec(
      "INSERT INTO users (id, email) VALUES (1, 'a@example.com'), (2, 'b@example.com')",
    );
    await harness.exec(
      "INSERT INTO posts (id, user_id, title) VALUES (1, 1, 'Own'), (2, 2, 'Theirs')",
    );
  });

  test("upsert leaves another owner's clashing row as it is, and doesn't count it", async () => {
    const user = await db().model(User).find(1);

    const result = await user.posts().upsert({ id: 2, title: "Mine now" });

    expect(result).toEqual({ rowsAffected: 0, rows: [] });
    expect(await posts()).toEqual([
      { id: 1, user_id: 1, title: "Own" },
      { id: 2, user_id: 2, title: "Theirs" },
    ]);
  });

  test("upsertAll updates the owner's rows and inserts new ones, but not another owner's (guard)", async () => {
    const user = await db().model(User).find(1);

    const result = await user.posts().upsertAll([
      { id: 1, title: "Own, renamed" },
      { id: 2, title: "Mine now" },
      { id: 3, title: "New" },
    ]);

    expect(result.rowsAffected).toBe(2);
    expect(result.rows).toHaveLength(2);
    expect(result.rows).toEqual(expect.arrayContaining([{ id: 1 }, { id: 3 }]));
    expect(await posts()).toEqual([
      { id: 1, user_id: 1, title: "Own, renamed" },
      { id: 2, user_id: 2, title: "Theirs" },
      { id: 3, user_id: 1, title: "New" },
    ]);
  });

  test("a batch's upsert through a hasMany leaves another owner's row as it is (guard)", async () => {
    const user = await db().model(User).find(1);

    await batch((b) => [b.upsert(user.posts(), { id: 2, title: "Mine now" })]);

    expect(await posts()).toContainEqual({ id: 2, user_id: 2, title: "Theirs" });
  });

  test.each([
    ["narrowed", (user: User) => user.posts().where({ title: "Theirs" })],
    [
      "merged",
      (user: User, database: Database) =>
        user.posts().merge(database.model(Post).where({ userId: 2 })),
    ],
    ["or()ed", (user: User) => user.posts().or(user.posts().where({ title: "Theirs" }))],
  ])("a %s hasMany's upsert leaves another owner's row as it is (guard)", async (_, posts) => {
    const database = db();
    const user = await database.model(User).find(1);

    const result = await posts(user, database).upsert({ id: 2, title: "Mine now" });

    expect(result.rowsAffected).toBe(0);
    expect(await harness.exec("SELECT user_id, title FROM posts WHERE id = 2")).toEqual([
      { user_id: 2, title: "Theirs" },
    ]);
  });

  test("a Relation with no owner upserts any row its conditions name, as Rails does (guard)", async () => {
    await db().model(Post).where({ userId: 1 }).upsert({ id: 2, title: "Mine now" });

    expect(await harness.exec("SELECT user_id, title FROM posts WHERE id = 2")).toEqual([
      { user_id: 1, title: "Mine now" },
    ]);
  });
});
