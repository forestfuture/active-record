import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { hasMany, Model, RecordNotUnique } from "../../packages/active-record/src/index.ts";
import type { QueryEvent } from "../../packages/active-record/src/executor.ts";
import { openHarness, type Harness } from "../support/harness.ts";

class Comment extends Model.define({
  id: { type: "integer", null: false },
  postId: "integer",
  body: "string",
}) {
  static table = "comments";

  static {
    this.validates("body", { presence: true });
  }
}

const postAttributes = {
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
} as const;

class Post extends Model.define(postAttributes) {
  static table = "posts";

  comments = hasMany(Comment, { foreignKey: "postId" });
}

describe("a hasMany's collection methods", () => {
  let harness: Harness;
  const queries: QueryEvent[] = [];
  let database: ReturnType<Harness["connect"]>;
  const db = () => database;
  const bodies = async (postId: number | null) =>
    (await db().model(Comment).where({ postId }).order({ id: "asc" }).toArray()).map(
      (comment) => comment.body,
    );

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.reset("comments", "posts", "users");
    await harness.exec("INSERT INTO users (id, email) VALUES (1, 'a@example.com')");
    await harness.exec(
      "INSERT INTO posts (id, user_id, title) VALUES (1, 1, 'First'), (2, 1, 'Second')",
    );
    await harness.exec(
      "INSERT INTO comments (id, post_id, body) VALUES (10, 1, 'a'), (11, 1, 'b'), (20, 2, 'c')",
    );
    database = harness.connect({ onQuery: (event) => queries.push(event) });
    queries.length = 0;
  });

  describe("push", () => {
    test("sets each record's foreign key and saves it", async () => {
      const post = await db().model(Post).find(1);
      const moved = await db().model(Comment).find(20);
      const added = db().model(Comment).build({ body: "new" });

      expect(await post.comments().push(moved, added)).toBe(true);

      expect(moved.postId).toBe(1);
      expect(added.isPersisted()).toBe(true);
      expect(await bodies(1)).toEqual(["a", "b", "c", "new"]);
    });

    test("writes nothing and resolves to false if one record can't be saved", async () => {
      const post = await db().model(Post).find(1);
      const moved = await db().model(Comment).find(20);
      const invalid = db().model(Comment).build({ body: "" });

      expect(await post.comments().push(moved, invalid)).toBe(false);

      expect(invalid.errors.get("body")).not.toEqual([]);
      expect(await bodies(2)).toEqual(["c"]);
    });

    test("saves the records in one write, atomically", async () => {
      const post = await db().model(Post).find(1);
      const moved = await db().model(Comment).find(20);
      const clashing = db().model(Comment).build({ id: 10, body: "clash" });

      await expect(post.comments().push(moved, clashing)).rejects.toThrow(RecordNotUnique);

      expect(await bodies(2)).toEqual(["c"]);
    });

    test("on a loaded collection, the records join it", async () => {
      const post = await db().model(Post).find(1);
      await post.comments().toArray();
      const moved = await db().model(Comment).find(20);
      queries.length = 0;

      await post.comments().push(moved);
      const loaded = await post.comments().toArray();

      expect(loaded.map((comment) => comment.body)).toEqual(["a", "b", "c"]);
      expect(loaded[2]).toBe(moved);
      expect(queries).toHaveLength(1);
    });

    test("on a new owner, saves nothing until the owner is saved", async () => {
      const post = db().model(Post).build({ userId: 1, title: "Third" });
      const moved = await db().model(Comment).find(20);
      const added = db().model(Comment).build({ body: "new" });
      queries.length = 0;

      expect(await post.comments().push(moved, added)).toBe(true);
      expect(queries).toHaveLength(0);
      expect(await post.comments().toArray()).toEqual([moved, added]);

      await post.saveOrThrow();

      expect(await bodies(post.id)).toEqual(["c", "new"]);
      expect(moved.postId).toBe(post.id);
    });

    test("throws TypeError for a record of another Model", async () => {
      const post = await db().model(Post).find(1);
      const other = await db().model(Post).find(2);

      await expect(post.comments().push(other as never)).rejects.toThrow(
        new TypeError("Post.comments takes Comment records, not a Post"),
      );
    });
  });
});
