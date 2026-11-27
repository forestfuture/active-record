import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  AssociationNotLoaded,
  belongsTo,
  hasMany,
  hasOne,
  Model,
} from "../../packages/arbor/src/index.ts";
import { openHarness, type Harness } from "../support/harness.ts";

class User extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  role: "string",
}) {
  static table = "users";
  static hiddenAttributes = ["role"];

  posts = hasMany(Post, { foreignKey: "userId" });
  profile = hasOne(Profile, { foreignKey: "userId" });

  get handle(): string {
    return this.email.split("@")[0]!;
  }

  firstSeen(): Date {
    return new Date(Date.UTC(2026, 0, this.id));
  }

  async rank(): Promise<number> {
    return this.id;
  }
}

class Post extends Model.define({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
}) {
  static table = "posts";

  author = belongsTo(User, { foreignKey: "userId" });
  comments = hasMany(Comment, { foreignKey: "postId" });
}

class Comment extends Model.define({
  id: { type: "integer", null: false },
  postId: "integer",
  body: "string",
}) {
  static table = "comments";
  static hiddenAttributes = ["postId"];
}

class Profile extends Model.define({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  bio: "string",
}) {
  static table = "profiles";
}

// What toJSON's options choose to send: associations it was given, and which attributes (#300).
describe("toJSON options", () => {
  let harness: Harness;
  const db = () => harness.connect();

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.reset("comments", "posts", "profiles", "users");
    await harness.exec(
      "INSERT INTO users (id, email, role) VALUES (1, 'jane@example.com', 'admin'), (2, 'sam@example.com', NULL)",
    );
    await harness.exec(
      "INSERT INTO posts (id, user_id, title) VALUES (10, 1, 'First'), (11, 1, 'Second')",
    );
    await harness.exec("INSERT INTO comments (id, post_id, body) VALUES (20, 10, 'Nice')");
    await harness.exec("INSERT INTO profiles (id, user_id, bio) VALUES (30, 1, 'Writes')");
  });

  describe("include", () => {
    test("a hasMany is sent as its records, in their loaded order", async () => {
      const jane = await db().model(User).includes("posts").find(1);

      expect(jane.toJSON({ include: "posts" })).toEqual({
        id: 1,
        email: "jane@example.com",
        posts: [
          { id: 10, userId: 1, title: "First" },
          { id: 11, userId: 1, title: "Second" },
        ],
      });
    });

    test("a belongsTo is sent as its record", async () => {
      const post = await db().model(Post).includes("author").find(10);

      expect(post.toJSON({ include: "author" })).toEqual({
        id: 10,
        userId: 1,
        title: "First",
        author: { id: 1, email: "jane@example.com" },
      });
    });

    test("a hasOne with no record is sent as null", async () => {
      const sam = await db().model(User).includes("profile").find(2);

      expect(sam.toJSON({ include: "profile" })).toEqual({
        id: 2,
        email: "sam@example.com",
        profile: null,
      });
    });

    test("a list sends each association it names", async () => {
      const jane = await db().model(User).includes("posts", "profile").find(1);

      expect(jane.toJSON({ include: ["posts", "profile"] })).toMatchObject({
        posts: [{ title: "First" }, { title: "Second" }],
        profile: { id: 30, userId: 1, bio: "Writes" },
      });
    });

    test("a nested include sends the included records' own associations, without their hidden attributes", async () => {
      const jane = await db().model(User).includes({ posts: "comments" }).find(1);

      expect(jane.toJSON({ include: { posts: "comments" } })).toEqual({
        id: 1,
        email: "jane@example.com",
        posts: [
          { id: 10, userId: 1, title: "First", comments: [{ id: 20, body: "Nice" }] },
          { id: 11, userId: 1, title: "Second", comments: [] },
        ],
      });
    });

    test("an association read lazily is sent as a preloaded one is", async () => {
      const post = await db().model(Post).find(10);
      await post.author();

      expect(post.toJSON({ include: "author" })).toMatchObject({ author: { id: 1 } });
    });

    test("an association that wasn't loaded throws AssociationNotLoaded", async () => {
      const jane = await db().model(User).find(1);

      expect(() => jane.toJSON({ include: "posts" })).toThrow(
        new AssociationNotLoaded(
          'User record hasn\'t loaded "posts"; preload it with includes("posts"), or read it first',
        ),
      );
    });

    test("JSON.stringify sends the attributes alone, since the key it passes isn't options", async () => {
      const jane = await db().model(User).includes("posts").find(1);

      expect(JSON.parse(JSON.stringify({ user: jane }))).toEqual({
        user: { id: 1, email: "jane@example.com" },
      });
    });
  });

  describe("only and except", () => {
    test("only sends the attributes it names", async () => {
      const jane = await db().model(User).find(1);

      expect(jane.toJSON({ only: ["email"] })).toEqual({ email: "jane@example.com" });
    });

    test("except sends every attribute but those it names", async () => {
      const post = await db().model(Post).find(10);

      expect(post.toJSON({ except: ["userId"] })).toEqual({ id: 10, title: "First" });
    });

    test("only wins when both are given", async () => {
      const post = await db().model(Post).find(10);
      const both = { only: ["title"], except: ["title"] } as never;

      expect(post.toJSON(both)).toEqual({ title: "First" });
    });

    test("only never sends a hidden attribute", async () => {
      const jane = await db().model(User).find(1);

      expect(jane.toJSON({ only: ["email", "role"] })).toEqual({ email: "jane@example.com" });
    });

    test("only leaves out an attribute a partial record didn't load", async () => {
      const [jane] = await db().model(User).select("id").toArray();

      expect(jane!.toJSON({ only: ["id", "email"] })).toEqual({ id: 1 });
    });

    test("a name the Model has no attribute for throws, so a typo in except can't send it", async () => {
      const jane = await db().model(User).find(1);

      expect(() => jane.toJSON({ except: ["emial" as "email"] })).toThrow(
        new TypeError('User has no attribute "emial"; toJSON\'s except names attributes exactly'),
      );
    });
  });

  describe("methods", () => {
    test("adds each getter's or method's value, a date as an ISO string", async () => {
      const jane = await db().model(User).find(1);

      expect(jane.toJSON({ methods: ["handle", "firstSeen"] })).toEqual({
        id: 1,
        email: "jane@example.com",
        handle: "jane",
        firstSeen: "2026-01-01T00:00:00.000Z",
      });
    });

    test("adds their values whatever only says", async () => {
      const jane = await db().model(User).find(1);

      expect(jane.toJSON({ only: ["id"], methods: ["handle"] })).toEqual({ id: 1, handle: "jane" });
    });

    test("a name the record has no member for throws", async () => {
      const jane = await db().model(User).find(1);

      expect(() => jane.toJSON({ methods: ["handel" as "handle"] })).toThrow(
        new TypeError(
          "User has no method or getter \"handel\"; toJSON's methods names the record's own",
        ),
      );
    });

    test("a method that returns a promise throws, since toJSON can't wait for it", async () => {
      const jane = await db().model(User).find(1);

      expect(() => jane.toJSON({ methods: ["rank" as "handle"] })).toThrow(
        new TypeError("User's \"rank\" returned a promise; toJSON's methods can't wait for one"),
      );
    });
  });
});
