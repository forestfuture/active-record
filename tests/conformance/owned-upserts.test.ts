import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { belongsTo, hasMany, Model } from "../../packages/active-record/src/index.ts";
import { openHarness, type Harness } from "../support/harness.ts";

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
});
