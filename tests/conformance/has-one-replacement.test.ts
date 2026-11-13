import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  belongsTo,
  hasOne,
  Model,
  RecordNotSaved,
  RecordNotUnique,
} from "../../packages/active-record/src/index.ts";
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

  static {
    this.validates("body", { presence: true });
  }
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

class KeepingUser extends Model.define(userAttributes) {
  static table = "users";
  profile = hasOne(Profile, { foreignKey: "userId" });
  ownProfile = hasOne(OwnedProfile, { foreignKey: "userId" });
}

class OwnedProfile extends Model.define({
  id: { type: "integer", null: false },
  userId: "integer",
  bio: "string",
}) {
  static table = "profiles";
  user = belongsTo(KeepingUser, { foreignKey: "userId" });
}

class Holder extends Model.define({
  id: { type: "string", null: false },
  label: { type: "string", null: false },
}) {
  static table = "api_keys";
  account = hasOne(Member, { foreignKey: "externalAccountId", dependent: "delete" });
}

class Member extends Model.define({
  id: { type: "integer", null: false },
  externalAccountId: "string",
  userId: "integer",
}) {
  static table = "accounts";
  user = belongsTo(KeepingUser, { foreignKey: "userId", optional: true });
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
    await harness.reset("comments", "posts", "profiles", "users", "accounts", "api_keys");
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

    test("set(null) removes the old record by dependent, and reads as null", async () => {
      const user = await db().model(Destroying).find(1);

      await user.profile.set(null);

      expect(log).toEqual(["destroyed Old"]);
      expect(await bios()).toEqual([]);
      events.length = 0;
      expect(await user.profile()).toBeNull();
      expect(events).toHaveLength(0);
    });

    test("setting the record it already has removes nothing", async () => {
      const post = await db().model(Keeping).find(10);
      const pinned = await post.pinned();

      await post.pinned.set(pinned);

      expect((await comments()).map((row) => [row.post_id, row.body])).toEqual([[10, "Old"]]);
    });

    test("the old record stays when the new one's write fails: one batch", async () => {
      await harness.exec("INSERT INTO users (id, email) VALUES (2, 'b@example.com')");
      await harness.exec("INSERT INTO profiles (id, user_id, bio) VALUES (2, 2, 'Taken')");
      const user = await db().model(Destroying).find(1);

      await expect(
        user.profile.set(db().model(Profile).build({ id: 2, bio: "New" })),
      ).rejects.toThrow(RecordNotUnique);

      expect((await bios()).map((row) => row.bio)).toEqual(["Old", "Taken"]);
    });

    test("a record that doesn't save throws RecordNotSaved, removes nothing, and is kept for the owner's save", async () => {
      const post = await db().model(Keeping).find(10);
      const comment = db().model(Comment).build({ body: "" });

      await expect(post.pinned.set(comment)).rejects.toThrow(
        new RecordNotSaved("Failed to save the new associated pinned"),
      );
      expect((await comments()).map((row) => [row.post_id, row.body])).toEqual([[10, "Old"]]);
      comment.body = "Fixed";
      await post.saveOrThrow();

      expect((await comments()).map((row) => [row.post_id, row.body])).toEqual([
        [null, "Old"],
        [10, "Fixed"],
      ]);
    });

    test("the old record stays when the new one's write fails after a new record it points at", async () => {
      await harness.exec("INSERT INTO api_keys (id, label) VALUES ('k1', 'Deploy')");
      await harness.exec(
        "INSERT INTO accounts (id, external_account_id) VALUES (1, 'k1'), (2, 'other')",
      );
      const holder = await db().model(Holder).find("k1");
      const account = db().model(Member).build({ id: 2 });
      account.user.build({ email: "new@example.com" });

      await expect(holder.account.set(account)).rejects.toThrow(RecordNotUnique);

      const rows = await harness.exec("SELECT id FROM accounts ORDER BY id");
      expect(rows.map((row) => row.id)).toEqual([1, 2]);
    });

    test("on an unsaved owner, a saved record is saved with it, taking its key", async () => {
      const comment = await db().model(Comment).find(1);
      const post = db().model(Keeping).build({ userId: 1, title: "New" });

      await post.pinned.set(comment);
      expect((await comments()).map((row) => row.post_id)).toEqual([10]);
      await post.saveOrThrow();

      expect(comment.postId).toBe(post.id);
      expect((await comments()).map((row) => row.post_id)).toEqual([post.id]);
    });
  });
  describe("build() and create()", () => {
    test("build() on a saved owner removes the old record when the owner is saved, not before", async () => {
      const user = await db().model(Destroying).find(1);

      const profile = user.profile.build({ bio: "New" });
      expect((await bios()).map((row) => row.bio)).toEqual(["Old"]);
      await user.saveOrThrow();

      expect(log).toEqual(["destroyed Old"]);
      expect(await bios()).toEqual([{ id: profile.id, user_id: 1, bio: "New" }]);
    });

    test("building twice saves the last record, and removes the old one once", async () => {
      const post = await db().model(Nullifying).find(10);

      post.pinned.build({ body: "First" });
      post.pinned.build({ body: "Second" });
      await post.saveOrThrow();

      expect((await comments()).map((row) => [row.post_id, row.body])).toEqual([
        [null, "Old"],
        [10, "Second"],
      ]);
    });

    test("create() on a saved owner removes the old record at once, by dependent", async () => {
      const user = await db().model(Deleting).find(1);
      const post = await db().model(Keeping).find(10);

      await user.profile.createOrThrow({ bio: "New" });
      await post.pinned.createOrThrow({ body: "New" });

      expect((await bios()).map((row) => row.bio)).toEqual(["New"]);
      expect((await comments()).map((row) => [row.post_id, row.body])).toEqual([
        [null, "Old"],
        [10, "New"],
      ]);
    });

    test("a create() that fails removes nothing, and saving the owner tries both again", async () => {
      const post = await db().model(Keeping).find(10);

      const comment = await post.pinned.create({ body: "" });
      expect((await comments()).map((row) => [row.post_id, row.body])).toEqual([[10, "Old"]]);
      comment.body = "Fixed";
      await post.saveOrThrow();

      expect((await comments()).map((row) => [row.post_id, row.body])).toEqual([
        [null, "Old"],
        [10, "Fixed"],
      ]);
    });
  });
  describe("an old record that can't be nullified", () => {
    const failed =
      "Failed to remove the existing associated profile. " +
      "The record failed to save after its foreign key was set to null.";

    test("a NOT NULL foreign key throws RecordNotSaved, and the new record isn't written", async () => {
      const user = await db().model(KeepingUser).find(1);

      await expect(user.profile.createOrThrow({ bio: "New" })).rejects.toThrow(
        new RecordNotSaved(failed),
      );

      expect((await bios()).map((row) => row.bio)).toEqual(["Old"]);
    });

    test("an old record its validations refuse throws RecordNotSaved, keeping its key", async () => {
      const user = await db().model(KeepingUser).find(1);
      const old = await user.ownProfile();

      await expect(
        user.ownProfile.set(db().model(OwnedProfile).build({ bio: "New" })),
      ).rejects.toThrow(new RecordNotSaved(failed.replace("profile.", "ownProfile.")));

      expect(old?.userId).toBe(1);
      expect((await bios()).map((row) => row.bio)).toEqual(["Old"]);
    });

    test("a set(null) that fails leaves a built record replacing the old one", async () => {
      const user = await db().model(KeepingUser).find(1);
      user.profile.build({ bio: "New" });

      await expect(user.profile.set(null)).rejects.toThrow(RecordNotSaved);
      await expect(user.saveOrThrow()).rejects.toThrow(RecordNotSaved);

      expect((await bios()).map((row) => row.bio)).toEqual(["Old"]);
    });
  });
});
