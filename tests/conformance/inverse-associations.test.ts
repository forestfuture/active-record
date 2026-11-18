import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { belongsTo, hasMany, hasOne, Model } from "../../packages/active-record/src/index.ts";
import type { QueryEvent } from "../../packages/active-record/src/executor.ts";
import { openHarness, type Harness } from "../support/harness.ts";

class User extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
}) {
  static table = "users";

  posts = hasMany(Post, { foreignKey: "userId" });
  profile = hasOne(Profile, { foreignKey: "userId" });
}

class Photo extends Model.define({
  id: { type: "integer", null: false },
  title: "string",
}) {
  static table = "photos";

  remarks = hasMany(Remark, { as: "commentable" });
  firstRemark = hasOne(Remark, { as: "commentable" });
}

class Remark extends Model.define({
  id: { type: "integer", null: false },
  body: "string",
  commentableType: "string",
  commentableId: "integer",
}) {
  static table = "remarks";

  commentable = belongsTo([Post, Photo], { optional: true });
}

class Comment extends Model.define({
  id: { type: "integer", null: false },
  postId: "integer",
}) {
  static table = "comments";

  post = belongsTo(Post, { foreignKey: "postId" });
}

class Post extends Model.define({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
}) {
  static table = "posts";

  author = belongsTo(User, { foreignKey: "userId" });
  comments = hasMany(Comment, { foreignKey: "postId" });
  remarks = hasMany(Remark, { as: "commentable" });
}

class Profile extends Model.define({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  bio: "string",
}) {
  static table = "profiles";

  user = belongsTo(User, { foreignKey: "userId" });
}

describe("inverse associations", () => {
  let harness: Harness;
  const queries: QueryEvent[] = [];
  const db = () => harness.connect({ onQuery: (event) => queries.push(event) });

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.reset("remarks", "photos", "comments", "posts", "profiles", "users");
    await harness.exec(
      "INSERT INTO users (id, email) VALUES (1, 'a@example.com'), (2, 'b@example.com')",
    );
    await harness.exec(
      "INSERT INTO posts (id, user_id, title) VALUES (10, 1, 'A1'), (11, 1, 'A2'), (12, 2, 'B1')",
    );
    await harness.exec("INSERT INTO profiles (id, user_id, bio) VALUES (1, 1, 'Ay')");
    await harness.exec("INSERT INTO comments (id, post_id) VALUES (1, 10), (2, 10)");
    await harness.exec("INSERT INTO photos (id, title) VALUES (10, 'Sunset')");
    await harness.exec(
      "INSERT INTO remarks (id, body, commentable_type, commentable_id) VALUES (1, 'On a post', 'Post', 10), (2, 'On a photo', 'Photo', 10)",
    );
    queries.length = 0;
  });

  /** Loads user 1, then forgets the query it took. */
  async function firstUser(): Promise<User> {
    const user = await db().model(User).find(1);
    queries.length = 0;
    return user;
  }

  describe("a hasMany's records", () => {
    test("loaded through the association point back at their owner", async () => {
      const user = await firstUser();

      const posts = await user.posts().toArray();
      queries.length = 0;

      for (const post of posts) {
        expect(post.loaded("author")).toBe(user);
        expect(await post.author()).toBe(user);
      }
      expect(queries).toHaveLength(0);
    });

    test("found by its finders point back at their owner", async () => {
      const user = await firstUser();

      const found = [
        await user.posts().first(),
        await user.posts().last(),
        await user.posts().find(11),
        await user.posts().findBy({ title: "A1" }),
        await user
          .posts()
          .sole()
          .catch(() => null),
      ].filter((post) => post !== null);

      expect(found).toHaveLength(4);
      for (const post of found) expect(post.loaded("author")).toBe(user);
    });

    test("loaded by a Relation narrowed from the association point back at their owner", async () => {
      const user = await firstUser();

      const [narrowed] = await user.posts().where({ title: "A2" }).toArray();
      const batched: Post[] = [];
      for await (const post of user.posts().findEach()) batched.push(post);
      const { records: paged } = await user.posts().paginate({ page: 1, perPage: 1 });

      for (const post of [narrowed!, ...batched, ...paged]) {
        expect(post.loaded("author")).toBe(user);
      }
    });

    test("loaded by a Relation joined with another owner's point back only at their own", async () => {
      const users = db().model(User);
      const [user, other] = [await users.find(1), await users.find(2)];

      const posts = await user.posts().or(other.posts()).toArray();

      expect(posts.map((post) => post.id)).toEqual([10, 11, 12]);
      expect(posts[0]!.loaded("author")).toBe(user);
      expect(posts[2]!.isLoaded("author")).toBe(false);
    });

    test("loaded by a plain query don't point at any owner", async () => {
      const [post] = await db().model(Post).where({ id: 10 }).toArray();

      expect(post!.isLoaded("author")).toBe(false);
    });
  });

  describe("a hasOne's record", () => {
    test("read through the association points back at its owner", async () => {
      const user = await firstUser();

      const profile = await user.profile();
      queries.length = 0;

      expect(profile!.loaded("user")).toBe(user);
      expect(await profile!.user()).toBe(user);
      expect(queries).toHaveLength(0);
    });
  });

  describe("a belongsTo's record", () => {
    test("read through the association has its owner as its inverse hasOne", async () => {
      const profile = await db().model(Profile).find(1);

      const user = await profile.user();
      queries.length = 0;

      expect(user!.loaded("profile")).toBe(profile);
      expect(await user!.profile()).toBe(profile);
      expect(queries).toHaveLength(0);
    });

    test("doesn't fill its inverse hasMany: one record isn't the collection", async () => {
      const post = await db().model(Post).find(10);

      const user = await post.author();

      expect(user!.isLoaded("posts")).toBe(false);
    });
  });

  describe("preloaded records", () => {
    test("of a hasMany and a hasOne point back at their owner", async () => {
      const [user] = await db().model(User).where({ id: 1 }).includes("posts", "profile").toArray();
      queries.length = 0;

      for (const post of user!.loaded("posts")) expect(post.loaded("author")).toBe(user);
      expect(user!.loaded("profile")!.loaded("user")).toBe(user);
      expect(queries).toHaveLength(0);
    });

    test("of a belongsTo have their owner as their inverse hasOne", async () => {
      const [profile] = await db().model(Profile).includes("user").toArray();

      expect(profile!.loaded("user")!.loaded("profile")).toBe(profile);
    });

    test("at every level of a nested preload point back at their owner", async () => {
      const [user] = await db()
        .model(User)
        .where({ id: 1 })
        .includes({ posts: "comments" })
        .toArray();

      const post = user!.loaded("posts").find((each) => each.id === 10)!;
      expect(post.loaded("author")).toBe(user);
      for (const comment of post.loaded("comments")) expect(comment.loaded("post")).toBe(post);
    });

    test("of a polymorphic hasMany point back through the belongsTo's branch", async () => {
      const [post] = await db().model(Post).where({ id: 10 }).includes("remarks").toArray();
      const [photo] = await db().model(Photo).includes("remarks").toArray();

      expect(post!.loaded("remarks")[0]!.loaded("commentable")).toBe(post);
      expect(photo!.loaded("remarks")[0]!.loaded("commentable")).toBe(photo);
    });

    test("of a polymorphic belongsTo have their owner as the inverse hasOne", async () => {
      const remarks = await db()
        .model(Remark)
        .order({ id: "asc" })
        .includes("commentable")
        .toArray();

      const [onPost, onPhoto] = remarks;
      expect((onPhoto!.loaded("commentable") as Photo).loaded("firstRemark")).toBe(onPhoto);
      expect(onPost!.loaded("commentable")).toBeInstanceOf(Post);
    });
  });

  test("a polymorphic belongsTo's read has its owner as the inverse hasOne", async () => {
    const remark = await db().model(Remark).find(2);

    const photo = (await remark.commentable()) as Photo;

    expect(photo.loaded("firstRemark")).toBe(remark);
  });
});
