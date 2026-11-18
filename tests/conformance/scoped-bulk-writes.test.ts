import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { batch, Model, type Relation } from "../../packages/active-record/src/index.ts";
import { openHarness, type Harness } from "../support/harness.ts";

class Post extends Model.define({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
  published: "boolean",
}) {
  static table = "posts";
}

/** Posts whose default scope keeps them published. */
class PublishedPost extends Post {
  static {
    this.defaultScope((q) => q.where({ published: true }));
  }
}

// A bulk write takes its Relation's equality values over the ones it's given, as Rails'
// insert_all merges scope_for_create into each row (#470).
describe("a bulk write through a Relation's conditions", () => {
  let harness: Harness;
  const db = () => harness.connect();
  const storedPosts = () => harness.exec("SELECT id, user_id, title FROM posts ORDER BY id");

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.reset("posts", "users");
    await harness.exec(
      "INSERT INTO users (id, email) VALUES (1, 'a@example.com'), (2, 'b@example.com')",
    );
  });

  test("insert stores the condition's value over the one given", async () => {
    await db().model(Post).where({ userId: 1 }).insert({ id: 1, title: "Hi", userId: 2 });

    expect(await storedPosts()).toEqual([{ id: 1, user_id: 1, title: "Hi" }]);
  });

  test.each([
    ["insertAll", (posts: Relation<Post>) => posts.insertAll([{ id: 1, title: "Hi", userId: 2 }])],
    ["upsert", (posts: Relation<Post>) => posts.upsert({ id: 1, title: "Hi", userId: 2 })],
    ["upsertAll", (posts: Relation<Post>) => posts.upsertAll([{ id: 1, title: "Hi", userId: 2 }])],
    [
      "a batch's insert",
      (posts: Relation<Post>) => batch((b) => [b.insert(posts, { id: 1, title: "Hi", userId: 2 })]),
    ],
    [
      "a batch's insertAll",
      (posts: Relation<Post>) =>
        batch((b) => [b.insertAll(posts, [{ id: 1, title: "Hi", userId: 2 }])]),
    ],
    [
      "a batch's upsert",
      (posts: Relation<Post>) => batch((b) => [b.upsert(posts, { id: 1, title: "Hi", userId: 2 })]),
    ],
    [
      "a batch's upsertAll",
      (posts: Relation<Post>) =>
        batch((b) => [b.upsertAll(posts, [{ id: 1, title: "Hi", userId: 2 }])]),
    ],
  ])("%s stores the condition's value over the one given", async (_, write) => {
    await write(db().model(Post).where({ userId: 1 }));

    expect(await storedPosts()).toEqual([{ id: 1, user_id: 1, title: "Hi" }]);
  });

  test("an upsert updating a row writes the condition's value over the one given", async () => {
    await harness.exec("INSERT INTO posts (id, user_id, title) VALUES (1, 2, 'Old')");

    await db().model(Post).where({ userId: 1 }).upsert({ id: 1, title: "New", userId: 2 });

    expect(await storedPosts()).toEqual([{ id: 1, user_id: 1, title: "New" }]);
  });

  test("createWith's value goes over the one given", async () => {
    await db().model(Post).createWith({ userId: 1 }).insert({ id: 1, title: "A", userId: 2 });

    expect(await storedPosts()).toEqual([{ id: 1, user_id: 1, title: "A" }]);
  });

  test("createWith's value goes over a condition's", async () => {
    await db()
      .model(Post)
      .where({ userId: 2 })
      .createWith({ userId: 1 })
      .insert({ id: 1, title: "A" });

    expect(await storedPosts()).toEqual([{ id: 1, user_id: 1, title: "A" }]);
  });

  test("a default scope's value goes over the one given", async () => {
    await db().model(PublishedPost).insert({ id: 1, userId: 1, title: "Hi", published: false });

    expect(await db().model(Post).find(1)).toMatchObject({ published: true });
  });

  test.each([
    ["build", (posts: Relation<Post>) => posts.build({ id: 1, title: "Hi", userId: 2 })],
    ["create", (posts: Relation<Post>) => posts.create({ id: 1, title: "Hi", userId: 2 })],
  ])("%s keeps the value given over the condition's", async (_, make) => {
    const post = await make(db().model(Post).where({ userId: 1 }));

    expect(post.userId).toBe(2);
  });
});
