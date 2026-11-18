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

class Post extends Model.define({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
}) {
  static table = "posts";

  author = belongsTo(User, { foreignKey: "userId" });
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
    await harness.reset("posts", "profiles", "users");
    await harness.exec(
      "INSERT INTO users (id, email) VALUES (1, 'a@example.com'), (2, 'b@example.com')",
    );
    await harness.exec(
      "INSERT INTO posts (id, user_id, title) VALUES (10, 1, 'A1'), (11, 1, 'A2'), (12, 2, 'B1')",
    );
    await harness.exec("INSERT INTO profiles (id, user_id, bio) VALUES (1, 1, 'Ay')");
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
});
