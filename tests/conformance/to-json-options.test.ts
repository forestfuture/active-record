import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { belongsTo, hasMany, hasOne, Model } from "../../packages/arbor/src/index.ts";
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
  });
});
