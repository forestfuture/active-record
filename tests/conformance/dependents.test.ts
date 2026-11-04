import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  abort,
  DeleteRestriction,
  hasMany,
  hasOne,
  InvalidForeignKey,
  InvalidModel,
  Model,
  RecordNotDestroyed,
} from "../../src/index.ts";
import type { QueryEvent } from "../../src/executor.ts";
import { openHarness, type Harness } from "../support/harness.ts";

const log: string[] = [];

class Post extends Model.define({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
}) {
  static table = "posts";

  comments = hasMany(Comment, { foreignKey: "postId", dependent: "nullify" });

  static {
    this.beforeDestroy((post) => {
      if (post.title === "Keep") throw abort("this post is kept");
    });
    this.afterDestroy((post) => void log.push(`destroyed post ${post.id}`));
  }
}

class Comment extends Model.define({
  id: { type: "integer", null: false },
  postId: "integer",
  body: "string",
}) {
  static table = "comments";
}

class Profile extends Model.define({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
}) {
  static table = "profiles";
}

const userAttributes = {
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
} as const;

class User extends Model.define(userAttributes) {
  static table = "users";
}

class Destroying extends Model.define(userAttributes) {
  static table = "users";
  posts = hasMany(Post, { foreignKey: "userId", dependent: "destroy" });
  static {
    this.afterDestroy((user) => void log.push(`destroyed user ${user.id}`));
  }
}

class DeletingAll extends Model.define(userAttributes) {
  static table = "users";
  posts = hasMany(Post, { foreignKey: "userId", dependent: "deleteAll" });
}

class DeletingProfile extends Model.define(userAttributes) {
  static table = "users";
  profile = hasOne(Profile, { foreignKey: "userId", dependent: "delete" });
}

class Restricting extends Model.define(userAttributes) {
  static table = "users";
  posts = hasMany(Post, { foreignKey: "userId", dependent: "restrictWithException" });
}

class RestrictingWithError extends Model.define(userAttributes) {
  static table = "users";
  posts = hasMany(Post, { foreignKey: "userId", dependent: "restrictWithError" });
  profile = hasOne(Profile, { foreignKey: "userId", dependent: "restrictWithError" });
}

class RestrictingWithMessages extends RestrictingWithError {
  static {
    this.errorMessages({
      restrictDependentDestroy: {
        hasOne: "can't be deleted while it has a %{record}",
        hasMany: "can't be deleted while it has %{record}",
      },
    });
  }
}

class RestrictingRenamed extends RestrictingWithError {
  static {
    this.humanAttributeNames({ posts: "Articles" });
  }
}

class Aborting extends Model.define(userAttributes) {
  static table = "users";
  posts = hasMany(Post, { foreignKey: "userId", dependent: "deleteAll" });

  static {
    this.beforeDestroy(() => {
      throw abort("not today");
    });
  }
}

class PostWithReplies extends Model.define({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
}) {
  static table = "posts";
  // Only the comments this scope picks are nullified.
  loud = hasMany(Comment, {
    foreignKey: "postId",
    dependent: "nullify",
    scope: (q) => q.where({ body: "x" }),
  });
  quiet = hasMany(Comment, { foreignKey: "postId", dependent: "deleteAll" });
}

class Account extends Model.define({
  id: { type: "integer", null: false },
  userId: "integer",
}) {
  static table = "accounts";
  static {
    this.afterDestroy((account) => void log.push(`destroyed account ${account.id}`));
  }
}

class DeletingAccount extends Model.define(userAttributes) {
  static table = "users";
  account = hasOne(Account, { foreignKey: "userId", dependent: "delete" });
}

class NullifyingAccount extends Model.define(userAttributes) {
  static table = "users";
  account = hasOne(Account, { foreignKey: "userId", dependent: "nullify" });
}

class DestroyingAccount extends Model.define(userAttributes) {
  static table = "users";
  account = hasOne(Account, { foreignKey: "userId", dependent: "destroy" });
}

class RestrictingFirst extends Model.define(userAttributes) {
  static table = "users";
  posts = hasMany(Post, { foreignKey: "userId", dependent: "destroy" });
  profile = hasOne(Profile, {
    foreignKey: "userId",
    dependent: "restrictWithException",
  });
}

class Misdeclared extends Model.define(userAttributes) {
  static table = "users";
  profile = hasOne(Profile, { foreignKey: "userId", dependent: "deleteAll" as never });
}

describe("dependent: strategies", () => {
  let harness: Harness;
  const db = () => harness.connect();
  const count = async (table: string) =>
    (await harness.exec(`SELECT COUNT(*) AS n FROM ${table}`))[0]?.n;

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    log.length = 0;
    await harness.reset("comments", "posts", "profiles", "users");
    await harness.exec(
      "INSERT INTO users (id, email) VALUES (1, 'a@example.com'), (2, 'b@example.com')",
    );
    await harness.exec(
      "INSERT INTO posts (id, user_id, title) VALUES (10, 1, 'A'), (11, 1, 'B'), (12, 2, 'C')",
    );
    await harness.exec(
      "INSERT INTO comments (id, post_id, body) VALUES (1, 10, 'x'), (2, 12, 'y')",
    );
  });

  test("without a strategy, the foreign key constraint refuses to orphan the posts", async () => {
    const user = await db().model(User).find(1);

    await expect(user.destroy()).rejects.toThrow(InvalidForeignKey);
    expect(await count("users")).toBe(2);
  });

  test("destroy runs each record's destroy lifecycle, then deletes the owner", async () => {
    const user = await db().model(Destroying).find(1);

    expect(await user.destroy()).toBe(user);

    // Every afterDestroy runs after the one batch: the records' first, then the owner's.
    expect(log).toEqual(["destroyed post 10", "destroyed post 11", "destroyed user 1"]);
    expect(await db().model(Post).pluck("id")).toEqual([12]);
    // Each post's own dependent ran too: its comments were nullified.
    expect(await db().model(Comment).order({ id: "asc" }).pluck("postId")).toEqual([null, 12]);
  });

  test("destroy is atomic: if one record's destroy aborts, nothing is destroyed", async () => {
    await harness.exec("UPDATE posts SET title = 'Keep' WHERE id = 11");
    const user = await db().model(Destroying).find(1);

    await expect(user.destroy()).rejects.toThrow(RecordNotDestroyed);

    expect(log).toEqual([]);
    expect(await db().model(Post).order({ id: "asc" }).pluck("id")).toEqual([10, 11, 12]);
    expect(await count("users")).toBe(2);
  });

  test("deleteAll deletes the records in the same batch as the owner, without their callbacks", async () => {
    await harness.exec("DELETE FROM comments");
    const events: QueryEvent[] = [];
    const user = await harness
      .connect({ onQuery: (event) => events.push(event) })
      .model(DeletingAll)
      .find(1);
    events.length = 0;

    await user.destroyOrThrow();

    // Just the records' DELETE and the owner's, sent together; nothing read first.
    expect(events).toHaveLength(2);
    expect(log).toEqual([]);
    expect(await db().model(Post).pluck("id")).toEqual([12]);
    expect(await count("users")).toBe(1);
  });

  test("…so if the owner's DELETE fails, the records's deletion is rolled back too", async () => {
    await harness.reset("comments");
    await harness.exec("INSERT INTO profiles (id, user_id) VALUES (1, 1)");
    const user = await db().model(DeletingAll).find(1);

    await expect(user.destroy()).rejects.toThrow(InvalidForeignKey);

    expect(await db().model(Post).order({ id: "asc" }).pluck("id")).toEqual([10, 11, 12]);
  });

  test("nullify sets the records's foreign key to NULL", async () => {
    const post = await db().model(Post).find(10);

    await post.destroyOrThrow();

    expect(await db().model(Comment).order({ id: "asc" }).pluck("postId")).toEqual([null, 12]);
  });

  test("a hasOne's delete deletes its record", async () => {
    await harness.reset("comments", "posts");
    await harness.exec("INSERT INTO profiles (id, user_id) VALUES (1, 1), (2, 2)");
    const user = await db().model(DeletingProfile).find(1);

    await user.destroyOrThrow();

    expect(await db().model(Profile).pluck("id")).toEqual([2]);
  });

  test("restrictWithException throws DeleteRestriction while there are records", async () => {
    const user = await db().model(Restricting).find(1);

    const error: unknown = await user.destroy().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(DeleteRestriction);
    expect((error as Error).message).toBe("Cannot delete record because of dependent posts");
    expect(await count("users")).toBe(2);
  });

  test("restrictWithError adds an error instead, so destroy() returns false", async () => {
    await harness.exec("DELETE FROM comments WHERE id = 2");
    await harness.exec("DELETE FROM posts WHERE id = 12");
    await harness.exec("INSERT INTO profiles (id, user_id) VALUES (1, 2)");
    const withPosts = await db().model(RestrictingWithError).find(1);
    const withProfile = await db().model(RestrictingWithError).find(2);

    expect(await withPosts.destroy()).toBe(false);
    expect(withPosts.errors.get("base")).toEqual([
      "Cannot delete record because dependent posts exist",
    ]);
    await expect(withProfile.destroyOrThrow()).rejects.toThrow(RecordNotDestroyed);
    expect(withProfile.errors.get("base")).toEqual([
      "Cannot delete record because a dependent profile exists",
    ]);
    expect(await count("users")).toBe(2);
  });

  test("restrictDependentDestroy's messages can be replaced, for has-one and has-many", async () => {
    await harness.exec("DELETE FROM comments WHERE id = 2");
    await harness.exec("DELETE FROM posts WHERE id = 12");
    await harness.exec("INSERT INTO profiles (id, user_id) VALUES (1, 2)");
    const [withPosts, withProfile] = await db()
      .model(RestrictingWithMessages)
      .order({ id: "asc" })
      .toArray();

    await withPosts!.destroy();
    await withProfile!.destroy();

    expect(withPosts!.errors.get("base")).toEqual(["can't be deleted while it has posts"]);
    expect(withProfile!.errors.get("base")).toEqual(["can't be deleted while it has a profile"]);
  });

  test("restrictDependentDestroy names the association by its human name, in lowercase", async () => {
    const withPosts = await db().model(RestrictingRenamed).find(1);

    await withPosts.destroy();

    expect(withPosts.errors.get("base")).toEqual([
      "Cannot delete record because dependent articles exist",
    ]);
  });

  test("restricting lets an owner without records be destroyed", async () => {
    await harness.reset("comments", "posts");
    const user = await db().model(Restricting).find(1);

    expect(await user.destroy()).toBe(user);
  });

  test("strategies run after the owner's beforeDestroy callbacks, so an abort leaves the records alone", async () => {
    const user = await db().model(Aborting).find(1);

    expect(await user.destroy()).toBe(false);

    expect(await db().model(Post).count()).toBe(3);
  });

  test("deleteAll() on the association deletes with destroy or deleteAll, and nullifies otherwise", async () => {
    await harness.exec("DELETE FROM comments");
    const destroying = await db().model(Destroying).find(1);
    const post = await db().model(Post).find(12);
    await harness.exec("INSERT INTO comments (id, post_id, body) VALUES (3, 12, 'z')");

    await destroying.posts().deleteAll();
    await post.comments().deleteAll();

    expect(await db().model(Post).pluck("id")).toEqual([12]);
    expect(await db().model(Comment).pluck("postId")).toEqual([null]);
  });

  test("nullify only touches the records the association's scope picks", async () => {
    const post = await db().model(PostWithReplies).find(10);
    await harness.exec("INSERT INTO comments (id, post_id, body) VALUES (3, 10, 'z')");

    await post.destroyOrThrow();

    expect(await db().model(Comment).order({ id: "asc" }).pluck("id", "postId")).toEqual([
      [1, null],
      [2, 12],
    ]);
  });

  describe("a hasOne touches only its first record", () => {
    beforeEach(async () => {
      await harness.reset("comments", "posts", "accounts");
      // accounts.user_id has no foreign key, so a second match doesn't block the owner's DELETE.
      await harness.exec("INSERT INTO accounts (id, user_id) VALUES (1, 2), (2, 2)");
    });

    test("delete", async () => {
      await (await db().model(DeletingAccount).find(2)).destroyOrThrow();

      expect(await db().model(Account).pluck("id")).toEqual([2]);
    });

    test("nullify", async () => {
      await (await db().model(NullifyingAccount).find(2)).destroyOrThrow();

      expect(await db().model(Account).order({ id: "asc" }).pluck("id", "userId")).toEqual([
        [1, null],
        [2, 2],
      ]);
    });

    test("destroy", async () => {
      await (await db().model(DestroyingAccount).find(2)).destroyOrThrow();

      expect(log).toEqual(["destroyed account 1"]);
      expect(await db().model(Account).pluck("id")).toEqual([2]);
    });
  });

  test("every restriction is checked before any record is destroyed", async () => {
    await harness.exec("INSERT INTO profiles (id, user_id) VALUES (1, 1)");
    const user = await db().model(RestrictingFirst).find(1);

    await expect(user.destroy()).rejects.toThrow(DeleteRestriction);

    expect(log).toEqual([]);
    expect(await db().model(Post).count()).toBe(3);
  });

  test("a strategy the association kind doesn't have is an InvalidModel", () => {
    expect(() => db().model(Misdeclared)).toThrow(InvalidModel);
  });
});
