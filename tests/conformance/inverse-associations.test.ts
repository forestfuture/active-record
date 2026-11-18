import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  belongsTo,
  hasMany,
  hasOne,
  InvalidModel,
  Model,
} from "../../packages/active-record/src/index.ts";
import type { QueryEvent } from "../../packages/active-record/src/executor.ts";
import { openHarness, type Harness } from "../support/harness.ts";
import { statementKinds } from "../support/statement-kinds.ts";

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
  // Named as Profile's belongsTo is, but not the inverse of User's hasOne profile.
  user = belongsTo(User, { foreignKey: "userId", optional: true });
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
      ];

      for (const post of found) expect(post!.loaded("author")).toBe(user);
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

    test("loaded by a Relation combined with another owner's by or() point back only at their own", async () => {
      const users = db().model(User);
      const [user, other] = [await users.find(1), await users.find(2)];

      const posts = await user.posts().or(other.posts()).order({ id: "asc" }).toArray();

      expect(posts.map((post) => post.id)).toEqual([10, 11, 12]);
      expect(posts[0]!.loaded("author")).toBe(user);
      expect(posts[2]!.isLoaded("author")).toBe(false);
    });

    test("loaded by a plain query don't point at any owner", async () => {
      const [post] = await db().model(Post).where({ id: 10 }).toArray();

      expect(post!.isLoaded("author")).toBe(false);
    });
  });

  describe("a record built through a new owner", () => {
    test("keeps pointing back once saving the owner fills in its key", async () => {
      const user = db().model(User).build({ email: "new@example.com" });
      const post = user.posts().build({ title: "New" });
      const profile = user.profile.build({ bio: "New" });

      await user.saveOrThrow();
      queries.length = 0;

      expect(post.userId).toBe(user.id);
      expect(post.loaded("author")).toBe(user);
      expect(profile.loaded("user")).toBe(user);
      expect(queries).toHaveLength(0);
    });
  });

  test("autosave on both sides writes each record once (guard)", async () => {
    class Member extends Model.define({
      id: { type: "integer", null: false },
      email: { type: "string", null: false },
    }) {
      static table = "users";

      entries = hasMany(Entry, { foreignKey: "userId", autosave: true });
    }

    class Entry extends Model.define({
      id: { type: "integer", null: false },
      userId: { type: "integer", null: false },
      title: { type: "string", null: false },
    }) {
      static table = "posts";

      member = belongsTo(Member, { foreignKey: "userId", autosave: true });
    }

    const member = await db().model(Member).find(1);
    const [entry] = await member.entries().toArray();
    member.email = "changed@example.com";
    entry!.title = "Changed";
    queries.length = 0;

    await member.saveOrThrow();
    await entry!.saveOrThrow();

    expect(entry!.loaded("member")).toBe(member);
    expect(statementKinds(queries).filter((kind) => kind === "UPDATE")).toHaveLength(2);
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

    test("of another Model doesn't fill a hasOne whose inverse has its name", async () => {
      const post = await db().model(Post).find(10);

      const user = await post.user();

      expect(user!.isLoaded("profile")).toBe(false);
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

  describe("inverseOf", () => {
    class Writer extends Model.define({
      id: { type: "integer", null: false },
      email: { type: "string", null: false },
    }) {
      static table = "users";

      titled = hasMany(Article, {
        foreignKey: "userId",
        scope: (q) => q.where({ title: "A1" }),
        inverseOf: "editor",
      });
      untracked = hasMany(Article, { foreignKey: "userId", inverseOf: false });
      reviews = hasMany(Review, { foreignKey: "userId" });
      firstProfile = hasOne(Card, { foreignKey: "userId", scope: (q) => q.order({ id: "asc" }) });
    }

    class Article extends Model.define({
      id: { type: "integer", null: false },
      userId: { type: "integer", null: false },
      title: { type: "string", null: false },
    }) {
      static table = "posts";

      writer = belongsTo(Writer, { foreignKey: "userId" });
      editor = belongsTo(Writer, { foreignKey: "userId" });
    }

    class Review extends Model.define({
      id: { type: "integer", null: false },
      userId: { type: "integer", null: false },
      title: { type: "string", null: false },
    }) {
      static table = "posts";

      writer = belongsTo(Writer, { foreignKey: "userId", inverseOf: false });
    }

    class Card extends Model.define({
      id: { type: "integer", null: false },
      userId: { type: "integer", null: false },
    }) {
      static table = "profiles";

      holder = belongsTo(Writer, { foreignKey: "userId", inverseOf: "firstProfile" });
      unlinked = belongsTo(Writer, { foreignKey: "userId", inverseOf: false });
    }

    async function writer(): Promise<Writer> {
      return db().model(Writer).find(1);
    }

    test("names the inverse on an association with a scope, for loads and builds", async () => {
      const owner = await writer();

      const [loaded] = await owner.titled().toArray();
      const built = owner.titled().build({ title: "A1" });

      expect(loaded!.loaded("editor")).toBe(owner);
      expect(built.loaded("editor")).toBe(owner);
    });

    test("picks the belongsTo it names over the first with the same key", async () => {
      const [article] = await (await writer()).titled().toArray();

      expect(article!.isLoaded("writer")).toBe(false);
    });

    test("false turns the inverse off, for loads and builds", async () => {
      const owner = await writer();

      const [loaded] = await owner.untracked().toArray();
      const built = owner.untracked().build({ title: "New" });

      expect(loaded!.isLoaded("writer")).toBe(false);
      expect(built.isLoaded("writer")).toBe(false);
    });

    test("false on a belongsTo keeps the other side from inferring it", async () => {
      const [review] = await (await writer()).reviews().toArray();

      expect(review!.isLoaded("writer")).toBe(false);
    });

    test("on a belongsTo, names its inverse hasOne, even one with a scope", async () => {
      const card = await db().model(Card).find(1);

      const holder = await card.holder();
      const unlinked = await card.unlinked();

      expect(holder!.loaded("firstProfile")).toBe(card);
      expect(unlinked!.isLoaded("firstProfile")).toBe(false);
    });

    describe("is checked at first use", () => {
      class Target extends Model.define({
        id: { type: "integer", null: false },
        userId: { type: "integer", null: false },
        title: { type: "string", null: false },
      }) {
        static table = "posts";

        owner = belongsTo(Writer, { foreignKey: "userId" });
        byTitle = belongsTo(Writer, { foreignKey: "title", primaryKey: "email" });
        siblings = hasMany(Target, { foreignKey: "userId", primaryKey: "userId" });
      }

      /** The error using a Model whose association `field` declares throws. */
      function refusal(field: () => unknown): unknown {
        class Owner extends Model.define({
          id: { type: "integer", null: false },
          email: { type: "string", null: false },
        }) {
          static table = "users";

          declared = field();
        }
        try {
          db().model(Owner).build({ id: 1 });
        } catch (error) {
          return error;
        }
        return undefined;
      }

      test("a name the target has no association by", () => {
        expect(refusal(() => hasMany(Target, { foreignKey: "userId", inverseOf: "nope" }))).toEqual(
          new InvalidModel(
            'Owner association "declared": inverseOf names "nope", which isn\'t an association of Target',
          ),
        );
      });

      test("a hasMany naming an association other than a belongsTo", () => {
        expect(
          refusal(() => hasMany(Target, { foreignKey: "userId", inverseOf: "siblings" })),
        ).toEqual(
          new InvalidModel(
            'Owner association "declared": inverseOf must name a belongsTo of Target; "siblings" is a hasMany',
          ),
        );
      });

      test("a belongsTo naming a hasMany, which one record can't fill", () => {
        expect(
          refusal(() => belongsTo(Target, { foreignKey: "id", inverseOf: "siblings" })),
        ).toEqual(
          new InvalidModel(
            'Owner association "declared": inverseOf must name a hasOne of Target; "siblings" is a hasMany, and a belongsTo\'s record doesn\'t fill a collection',
          ),
        );
      });

      test("an association that doesn't link the same key back", () => {
        expect(
          refusal(() => hasMany(Target, { foreignKey: "userId", inverseOf: "byTitle" })),
        ).toEqual(
          new InvalidModel(
            'Owner association "declared": inverseOf "byTitle" doesn\'t link Target back to Owner through the same keys',
          ),
        );
      });

      test("a through association", () => {
        const through = { through: "others", inverseOf: "owner" } as never;
        const error = refusal(() => hasMany(Target, through));

        expect(error).toEqual(
          new InvalidModel(
            'Owner association "declared": a through association takes no inverseOf',
          ),
        );
      });
    });
  });
});
