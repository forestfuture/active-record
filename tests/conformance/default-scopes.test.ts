import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  belongsTo,
  hasMany,
  InvalidForeignKey,
  InvalidModel,
  Model,
  RecordNotFound,
  withDatabase,
} from "../../packages/active-record/src/index.ts";
import type { QueryEvent } from "../../packages/active-record/src/executor.ts";
import { openHarness, type Harness } from "../support/harness.ts";

class User extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
}) {
  static table = "users";

  posts = hasMany(Post, { foreignKey: "userId" });
}

class Post extends Model.define({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
  published: "boolean",
}) {
  static table = "posts";

  author = belongsTo(User, { foreignKey: "userId" });

  static titled = this.scope((q, title: string) => q.where({ title }));

  static {
    this.defaultScope((q) => q.where({ published: true }));
    this.validates("title", { uniqueness: true });
  }
}

class Comment extends Model.define({
  id: { type: "integer", null: false },
  postId: "integer",
  body: "string",
}) {
  static table = "comments";

  post = belongsTo(Post, { foreignKey: "postId" });
}

/** Users whose posts go when they do, as far as the posts' default scope shows them. */
class Leaving extends Model.define({ id: { type: "integer", null: false } }) {
  static table = "users";

  posts = hasMany(Post, { foreignKey: "userId", dependent: "destroy" });
}

/** Posts whose default scope starts from the Model itself, which runs without its default scope. */
class SelfScopedPost extends Model.define({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
  published: "boolean",
}) {
  static table = "posts";

  static {
    this.defaultScope((q) => q.merge(SelfScopedPost.where({ published: true })));
  }
}

/** Posts newest first, by default. */
class RecentPost extends Model.define({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
  published: "boolean",
}) {
  static table = "posts";

  static {
    this.defaultScope((q) => q.order({ id: "desc" }));
  }
}

/** Published posts by user 1: two default scopes, the second on a subclass. */
class OwnPost extends Post {
  static {
    this.defaultScope((q) => q.where({ userId: 1 }));
  }
}

describe("default scopes", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.reset("comments", "posts", "profiles", "users");
    await harness.exec(
      "INSERT INTO users (id, email) VALUES (1, 'a@example.com'), (2, 'b@example.com')",
    );
    await harness.exec(`INSERT INTO posts (id, user_id, title, published) VALUES
           (10, 1, 'Live', 1), (11, 1, 'Draft', 0), (12, 1, 'Also live', 1), (13, 2, 'Theirs', 1)`);
  });

  const titles = (rows: readonly { title: string }[]) => rows.map((row) => row.title).sort();

  test("narrows every query on the Model", async () => {
    const posts = harness.connect().model(Post);

    expect(await posts.where({ userId: 1 }).order({ id: "asc" }).pluck("title")).toEqual([
      "Live",
      "Also live",
    ]);
    expect(await posts.count()).toBe(3);
    expect(await posts.where({ title: "Draft" }).exists()).toBe(false);
  });

  test("find doesn't find a record it hides", async () => {
    const posts = harness.connect().model(Post);

    await expect(posts.find(11)).rejects.toThrow(RecordNotFound);
  });

  test("findBy doesn't find a record it hides", async () => {
    const posts = harness.connect().model(Post);

    expect(await posts.findBy({ title: "Draft" })).toBeNull();
  });

  test("unscoped() leaves it out, on the current database", async () => {
    const titlesFound = await withDatabase(harness.connect(), () =>
      Post.unscoped().where({ userId: 1 }).pluck("title"),
    );

    expect(titlesFound.sort()).toEqual(["Also live", "Draft", "Live"]);
  });

  test("a subclass's default scope adds to its parent's", async () => {
    const found = await harness.connect().model(OwnPost).toArray();

    expect(titles(found)).toEqual(["Also live", "Live"]);
  });

  test("a subclass's default scope doesn't change its parent's", async () => {
    expect(await harness.connect().model(Post).count()).toBe(3);
  });

  test("a default scope that queries its own Model runs without itself", async () => {
    const titlesFound = await withDatabase(harness.connect(), () =>
      SelfScopedPost.where({ userId: 1 }).pluck("title"),
    );

    expect(titlesFound.sort()).toEqual(["Also live", "Live"]);
  });

  test("its order is the Relation's order", async () => {
    const posts = harness.connect().model(RecentPost);

    expect((await posts.first())?.id).toBe(13);
    expect((await posts.last())?.id).toBe(10);
  });

  test("reorder replaces its order", async () => {
    const first = await harness.connect().model(RecentPost).reorder({ id: "asc" }).first();

    expect(first?.id).toBe(10);
  });

  test("a new record takes its equality values", () => {
    const post = harness.connect().model(Post).build({ id: 20, userId: 1, title: "New" });

    expect(post.published).toBe(true);
  });

  test("a value given to a new record wins over its own", () => {
    const post = harness
      .connect()
      .model(Post)
      .build({ id: 20, userId: 1, title: "New", published: false });

    expect(post.published).toBe(false);
  });

  test("insert takes its equality values", async () => {
    const db = harness.connect();

    await db.model(Post).insert({ id: 20, userId: 1, title: "Inserted" });

    expect(await db.model(Post).find(20)).toMatchObject({ published: true });
  });

  test("updateAll changes only the records it shows", async () => {
    const db = harness.connect();

    await db.model(Post).updateAll({ title: "Changed" });

    expect(
      await Post.unscoped()
        .where({ id: 11 })
        .pluck("title")
        .catch(() => null),
    ).toBeNull();
    const draft = await withDatabase(db, () => Post.unscoped().find(11));
    expect(draft.title).toBe("Draft");
  });

  test("deleteAll deletes only the records it shows", async () => {
    const db = harness.connect();

    await db.model(Post).deleteAll();

    const left = await withDatabase(db, () => Post.unscoped().pluck("title"));
    expect(left).toEqual(["Draft"]);
  });

  test("a hasMany reads its target through it", async () => {
    const user = await harness.connect().model(User).find(1);

    expect(titles(await user.posts().toArray())).toEqual(["Also live", "Live"]);
  });

  test("preloading a hasMany reads its target through it", async () => {
    const [user] = await harness.connect().model(User).where({ id: 1 }).includes("posts").toArray();

    expect(titles(user!.loaded("posts"))).toEqual(["Also live", "Live"]);
  });

  test("a belongsTo reads its target through it", async () => {
    await harness.exec("INSERT INTO comments (id, post_id, body) VALUES (1, 11, 'On a draft')");
    const comment = await harness.connect().model(Comment).find(1);

    expect(await comment.post()).toBeNull();
  });

  test("a required belongsTo whose record it hides must exist", async () => {
    const comment = harness.connect().model(Comment).build({ id: 1, postId: 11, body: "Hm" });

    expect(await comment.save()).toBe(false);
    expect(comment.errors.get("post")).toEqual(["must exist"]);
  });

  test("dependent: destroy leaves the records it hides, so the database refuses the owner's delete", async () => {
    const user = await harness.connect().model(Leaving).find(1);

    await expect(user.destroy()).rejects.toThrow(InvalidForeignKey);
  });

  test("reload ignores it", async () => {
    const db = harness.connect();
    const post = await db.model(Post).find(10);
    await harness.exec("UPDATE posts SET published = 0 WHERE id = 10");

    await post.reload();

    expect(post.published).toBe(false);
  });

  test("uniqueness ignores it", async () => {
    const post = harness.connect().model(Post).build({ id: 20, userId: 1, title: "Draft" });

    expect(await post.isValid()).toBe(false);
    expect(post.errors.get("title")).toEqual(["has already been taken"]);
  });

  test("a record's own update and destroy ignore it", async () => {
    const queries: QueryEvent[] = [];
    const db = harness.connect({ onQuery: (event) => queries.push(event) });
    const draft = await withDatabase(db, () => Post.unscoped().find(11));
    queries.length = 0;

    draft.title = "Edited draft";
    expect(await draft.save()).toBe(true);
    await draft.destroy();
    expect(draft.isDestroyed()).toBe(true);
    expect(queries.map((event) => event.sql)).not.toContainEqual(
      expect.stringContaining("published"),
    );
  });

  test("a named scope starts from it", async () => {
    expect(await harness.connect().model(Post).titled("Draft").count()).toBe(0);
  });

  test("or keeps it on both sides", async () => {
    const posts = harness.connect().model(Post);

    const found = await posts
      .where({ title: "Draft" })
      .or(posts.where({ title: "Live" }))
      .toArray();

    expect(titles(found)).toEqual(["Live"]);
  });

  test("declaring one once the Model has been used is an InvalidModel", async () => {
    await harness.connect().model(Post).count();

    expect(() => Post.defaultScope((q) => q)).toThrow(InvalidModel);
  });
});
