import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { hasOne, Model } from "../../packages/active-record/src/index.ts";
import type { QueryEvent } from "../../packages/active-record/src/executor.ts";
import { openHarness, type Harness } from "../support/harness.ts";

const log: string[] = [];

class Profile extends Model.define({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  bio: "string",
}) {
  static table = "profiles";

  static {
    this.afterDestroy((profile) => void log.push(`destroyed ${String(profile.bio)}`));
  }
}

class Comment extends Model.define({
  id: { type: "integer", null: false },
  postId: "integer",
  body: "string",
}) {
  static table = "comments";
}

const userAttributes = {
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
} as const;

class Destroying extends Model.define(userAttributes) {
  static table = "users";
  profile = hasOne(Profile, { foreignKey: "userId", dependent: "destroy" });
}

class Deleting extends Model.define(userAttributes) {
  static table = "users";
  profile = hasOne(Profile, { foreignKey: "userId", dependent: "delete" });
}

const postAttributes = {
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
} as const;

class Nullifying extends Model.define(postAttributes) {
  static table = "posts";
  pinned = hasOne(Comment, { foreignKey: "postId", dependent: "nullify" });
}

class Keeping extends Model.define(postAttributes) {
  static table = "posts";
  pinned = hasOne(Comment, { foreignKey: "postId" });
}

describe("replacing a hasOne's record", () => {
  let harness: Harness;
  const events: QueryEvent[] = [];
  let database: ReturnType<Harness["connect"]>;
  const db = () => database;
  const bios = () => harness.exec("SELECT id, user_id, bio FROM profiles ORDER BY id");
  const comments = () => harness.exec("SELECT id, post_id, body FROM comments ORDER BY id");

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    log.length = 0;
    await harness.reset("comments", "posts", "profiles", "users");
    await harness.exec("INSERT INTO users (id, email) VALUES (1, 'a@example.com')");
    await harness.exec("INSERT INTO posts (id, user_id, title) VALUES (10, 1, 'Hello')");
    await harness.exec("INSERT INTO profiles (id, user_id, bio) VALUES (1, 1, 'Old')");
    await harness.exec("INSERT INTO comments (id, post_id, body) VALUES (1, 10, 'Old')");
    database = harness.connect({ onQuery: (event) => events.push(event) });
    events.length = 0;
  });

  describe("set()", () => {
    test('"destroy" destroys the old record, callbacks included, and saves the new one', async () => {
      const user = await db().model(Destroying).find(1);
      const profile = db().model(Profile).build({ bio: "New" });

      await user.profile.set(profile);

      expect(log).toEqual(["destroyed Old"]);
      expect(await bios()).toEqual([{ id: profile.id, user_id: 1, bio: "New" }]);
      expect(await user.profile()).toBe(profile);
    });

    test('"delete" deletes the old record without its callbacks', async () => {
      const user = await db().model(Deleting).find(1);

      await user.profile.set(db().model(Profile).build({ bio: "New" }));

      expect(log).toEqual([]);
      expect((await bios()).map((row) => row.bio)).toEqual(["New"]);
    });

    test('"nullify" sets the old record\'s foreign key to null and saves it', async () => {
      const post = await db().model(Nullifying).find(10);

      await post.pinned.set(db().model(Comment).build({ body: "New" }));

      expect((await comments()).map((row) => [row.post_id, row.body])).toEqual([
        [null, "Old"],
        [10, "New"],
      ]);
    });

    test("without dependent, the old record is nullified", async () => {
      const post = await db().model(Keeping).find(10);

      await post.pinned.set(db().model(Comment).build({ body: "New" }));

      expect((await comments()).map((row) => [row.post_id, row.body])).toEqual([
        [null, "Old"],
        [10, "New"],
      ]);
    });
  });
});
