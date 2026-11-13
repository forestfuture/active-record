import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  abort,
  hasMany,
  Model,
  RecordNotDestroyed,
  RecordNotUnique,
} from "../../packages/active-record/src/index.ts";
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
    this.beforeDestroy((comment) => {
      if (comment.body === "keep") throw abort("this comment is kept");
    });
    this.afterDestroy((comment) => void destroyed.push(comment.body));
  }
}

const destroyed: (string | null)[] = [];

const postAttributes = {
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
} as const;

class Post extends Model.define(postAttributes) {
  static table = "posts";

  comments = hasMany(Comment, { foreignKey: "postId" });
}

class DeletingPost extends Model.define(postAttributes) {
  static table = "posts";

  comments = hasMany(Comment, { foreignKey: "postId", dependent: "deleteAll" });
}

class DestroyingPost extends Model.define(postAttributes) {
  static table = "posts";

  comments = hasMany(Comment, { foreignKey: "postId", dependent: "destroy" });
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
    destroyed.length = 0;
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

  describe("delete", () => {
    test("nullifies the records' foreign key by default, and resolves to them", async () => {
      const post = await db().model(Post).find(1);
      const comment = await db().model(Comment).find(10);

      expect(await post.comments().delete(comment)).toEqual([comment]);

      expect(await bodies(1)).toEqual(["b"]);
      expect(await bodies(null)).toEqual(["a"]);
    });

    test("with dependent: deleteAll, deletes their rows without callbacks", async () => {
      const post = await db().model(DeletingPost).find(1);
      const comments = await db().model(Comment).find(10, 11);

      await post.comments().delete(...comments);

      expect(await db().model(Comment).pluck("id")).toEqual([20]);
      expect(destroyed).toEqual([]);
    });

    test("with dependent: destroy, destroys them, callbacks included", async () => {
      const post = await db().model(DestroyingPost).find(1);
      const comment = await db().model(Comment).find(10);

      await post.comments().delete(comment);

      expect(comment.isDestroyed()).toBe(true);
      expect(destroyed).toEqual(["a"]);
      expect(await bodies(1)).toEqual(["b"]);
    });

    test("on a loaded collection, the records leave it", async () => {
      const post = await db().model(Post).find(1);
      const [first] = await post.comments().toArray();
      queries.length = 0;

      await post.comments().delete(first!);
      const loaded = await post.comments().toArray();

      expect(loaded.map((comment) => comment.body)).toEqual(["b"]);
      expect(queries).toHaveLength(1);
    });

    test("a record built through it leaves it, with no query", async () => {
      const post = await db().model(Post).find(1);
      const built = post.comments().build({ body: "new" });
      queries.length = 0;

      await post.comments().delete(built);
      await post.save();

      expect(queries).toHaveLength(0);
      expect(await bodies(1)).toEqual(["a", "b"]);
    });

    test("throws TypeError for another owner's record, or another Model's, sending nothing", async () => {
      const post = await db().model(Post).find(1);
      const others = await db().model(Comment).find(20);
      queries.length = 0;

      await expect(post.comments().delete(others)).rejects.toThrow(
        new TypeError("Post.comments doesn't hold this Comment: it belongs to another Post"),
      );
      await expect(post.comments().delete(post as never)).rejects.toThrow(TypeError);
      expect(queries).toHaveLength(0);
    });
  });

  describe("destroy", () => {
    test("destroys the records, whatever dependent: is, and resolves to them", async () => {
      const post = await db().model(Post).find(1);
      const comments = await db().model(Comment).find(10, 11);

      expect(await post.comments().destroy(...comments)).toEqual(comments);

      expect(comments.every((comment) => comment.isDestroyed())).toBe(true);
      expect(destroyed).toEqual(["a", "b"]);
      expect(await db().model(Comment).pluck("id")).toEqual([20]);
    });

    test("destroys nothing if one record's destroy aborts", async () => {
      await harness.exec("INSERT INTO comments (id, post_id, body) VALUES (12, 1, 'keep')");
      const post = await db().model(Post).find(1);
      const comments = await db().model(Comment).find(10, 12);

      await expect(post.comments().destroy(...comments)).rejects.toThrow(RecordNotDestroyed);

      expect(destroyed).toEqual([]);
      expect(await bodies(1)).toEqual(["a", "b", "keep"]);
    });

    test("on a loaded collection, the records leave it", async () => {
      const post = await db().model(Post).find(1);
      const [, second] = await post.comments().toArray();
      queries.length = 0;

      await post.comments().destroy(second!);
      const loaded = await post.comments().toArray();

      expect(loaded.map((comment) => comment.body)).toEqual(["a"]);
      expect(queries).toHaveLength(1);
    });

    test("throws TypeError for another owner's record", async () => {
      const post = await db().model(Post).find(1);
      const others = await db().model(Comment).find(20);

      await expect(post.comments().destroy(others)).rejects.toThrow(TypeError);
      expect(others.isDestroyed()).toBe(false);
    });
  });

  describe("clear", () => {
    test("nullifies every record's foreign key by default", async () => {
      const post = await db().model(Post).find(1);

      expect(await post.comments().clear()).toBeUndefined();

      expect(await bodies(1)).toEqual([]);
      expect(await bodies(null)).toEqual(["a", "b"]);
      expect(await bodies(2)).toEqual(["c"]);
    });

    test("with dependent: destroy, deletes the rows without callbacks, as deleteAll() does", async () => {
      const post = await db().model(DestroyingPost).find(1);

      await post.comments().clear();

      expect(await db().model(Comment).pluck("id")).toEqual([20]);
      expect(destroyed).toEqual([]);
    });

    test("leaves the collection loaded and empty, without the records built through it", async () => {
      const post = await db().model(Post).find(1);
      await post.comments().toArray();
      post.comments().build({ body: "new" });
      queries.length = 0;

      await post.comments().clear();

      expect(await post.comments().toArray()).toEqual([]);
      expect(queries).toHaveLength(1);
      await post.saveOrThrow();
      expect(await bodies(1)).toEqual([]);
    });

    test("on a new owner, forgets the records added to it, sending nothing", async () => {
      const post = db().model(Post).build({ userId: 1, title: "Third" });
      const moved = await db().model(Comment).find(20);
      await post.comments().push(moved, db().model(Comment).build({ body: "new" }));
      queries.length = 0;

      await post.comments().clear();
      await post.saveOrThrow();

      expect(queries.filter(({ model }) => model === "Comment")).toEqual([]);
      expect(await bodies(2)).toEqual(["c"]);
    });
  });
});
