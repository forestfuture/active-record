import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  abort,
  belongsTo,
  hasMany,
  hasOne,
  InvalidModel,
  DeleteRestriction,
  RecordNotDestroyed,
  RecordNotSaved,
  RecordNotUnique,
  Model,
} from "../../packages/active-record/src/index.ts";
import type { QueryEvent } from "../../packages/active-record/src/executor.ts";
import { openHarness, type Harness } from "../support/harness.ts";

const log: string[] = [];

class Comment extends Model.define({
  id: { type: "integer", null: false },
  postId: "integer",
  body: "string",
}) {
  static table = "comments";
}

class Post extends Model.define({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
}) {
  static table = "posts";

  comments = hasMany(Comment, { foreignKey: "postId", dependent: "deleteAll", autosave: true });

  static {
    this.afterDestroy((post) => void log.push(`destroyed ${post.title}`));
    this.beforeDestroy((post) => {
      if (post.title === "Pinned") throw abort("pinned posts stay");
    });
    this.validates("title", { presence: true });
    this.beforeValidation((post) => {
      if (post.title === "abort") throw abort("not today");
    });
  }
}

/** A post that can't be destroyed while it has comments. */
class GuardedPost extends Model.define({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
}) {
  static table = "posts";

  comments = hasMany(Comment, { foreignKey: "postId", dependent: "restrictWithError" });
}

/** A post that throws while it has comments. */
class LockedPost extends Model.define({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
}) {
  static table = "posts";

  comments = hasMany(Comment, { foreignKey: "postId", dependent: "restrictWithException" });
}

class Locker extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
}) {
  static table = "users";

  posts = hasMany(LockedPost, { foreignKey: "userId", autosave: true });
}

class Moderator extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
}) {
  static table = "users";

  posts = hasMany(GuardedPost, { foreignKey: "userId", autosave: true });
}

/** A comment that saves the post it's on, and destroys it when it's marked. */
class Reply extends Model.define({
  id: { type: "integer", null: false },
  postId: "integer",
  body: "string",
}) {
  static table = "comments";

  post = belongsTo(Post, { foreignKey: "postId", autosave: true, optional: true });

  static {
    this.beforeSave((reply) => {
      if (reply.body === "abort") throw abort("not now");
    });
  }
}

/** A post whose replies are destroyed with it, and a reply that can destroy its post. */
class Thread extends Model.define({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
}) {
  static table = "posts";

  replies = hasMany(ThreadReply, { foreignKey: "postId", dependent: "destroy" });
}

class ThreadReply extends Model.define({
  id: { type: "integer", null: false },
  postId: "integer",
  body: "string",
}) {
  static table = "comments";

  post = belongsTo(Thread, { foreignKey: "postId", autosave: true, optional: true });
}

/** A post that can't be destroyed while it has replies, and a reply that can destroy it. */
class LockedThread extends Model.define({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
}) {
  static table = "posts";

  replies = hasMany(LockedReply, { foreignKey: "postId", dependent: "restrictWithError" });
}

class LockedReply extends Model.define({
  id: { type: "integer", null: false },
  postId: "integer",
  body: "string",
}) {
  static table = "comments";

  post = belongsTo(LockedThread, { foreignKey: "postId", autosave: true, optional: true });
}

/** A post linked to a reply twice: by the reply's postId, and by a reply sharing its id. */
class KeyedThread extends Model.define({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
}) {
  static table = "posts";

  replies = hasMany(KeyedReply, { foreignKey: "postId" });
  sameId = hasMany(KeyedReply, { foreignKey: "id", dependent: "restrictWithError" });
}

class KeyedReply extends Model.define({
  id: { type: "integer", null: false },
  postId: "integer",
  body: "string",
}) {
  static table = "comments";

  post = belongsTo(KeyedThread, { foreignKey: "postId", autosave: true, optional: true });
}

/** A comment that requires its post. */
class StrictReply extends Model.define({
  id: { type: "integer", null: false },
  postId: "integer",
  body: "string",
}) {
  static table = "comments";

  post = belongsTo(Post, { foreignKey: "postId", autosave: true });
}

class Profile extends Model.define({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  bio: "string",
}) {
  static table = "profiles";

  static {
    this.beforeDestroy((profile) => {
      if (profile.bio === "Pinned") throw abort("pinned profiles stay");
    });
  }
}

class Author extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
}) {
  static table = "users";

  posts = hasMany(Post, { foreignKey: "userId", autosave: true });
  profile = hasOne(Profile, { foreignKey: "userId", autosave: true });
}

/** An author whose featured post is also one of its posts. */
class FeaturingAuthor extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
}) {
  static table = "users";

  posts = hasMany(Post, { foreignKey: "userId", autosave: true });
  featured = hasOne(Post, { foreignKey: "userId", autosave: true });
}

/** The same table, with the default autosave: only new records. */
class PlainAuthor extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
}) {
  static table = "users";

  posts = hasMany(Post, { foreignKey: "userId" });
}

describe("autosave: true (#37)", () => {
  let harness: Harness;
  const events: QueryEvent[] = [];
  let database: ReturnType<Harness["connect"]>;
  const db = () => database;

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.reset("comments", "profiles", "posts", "users");
    log.length = 0;
    database = harness.connect({ onQuery: (event) => events.push(event) });
    events.length = 0;
  });

  /** An author with two stored posts, its posts loaded. */
  async function authorWithPosts<
    M extends
      | typeof Author
      | typeof PlainAuthor
      | typeof Moderator
      | typeof FeaturingAuthor
      | typeof Locker,
  >(model: M) {
    await harness.exec("INSERT INTO users (id, email) VALUES (1, 'a@example.com')");
    await harness.exec("INSERT INTO posts (id, user_id, title) VALUES (10, 1, 'One')");
    await harness.exec("INSERT INTO posts (id, user_id, title) VALUES (11, 1, 'Two')");
    const author = await db().model(model).find(1);
    const posts = await author.posts().toArray();
    events.length = 0;
    return { author, posts };
  }

  const titles = () => db().model(Post).order({ id: "asc" }).pluck("title");

  test("saving the owner saves its loaded records that changed, even an owner with no changes", async () => {
    const { author, posts } = await authorWithPosts(Author);
    posts[0]!.title = "Changed";

    expect(await author.save()).toBe(true);

    expect(posts[0]!.isChanged()).toBe(false);
    expect(await titles()).toEqual(["Changed", "Two"]);
  });

  test("a changed record two of the owner's associations hold is written once", async () => {
    const { author, posts } = await authorWithPosts(FeaturingAuthor);
    await author.featured.set(posts[0]!);
    posts[0]!.title = "Changed";
    events.length = 0;

    await author.saveOrThrow();

    expect(events.filter(({ sql }) => sql.startsWith("UPDATE"))).toHaveLength(1);
  });

  test("the destroys and saves are one atomic batch: a write that fails leaves them all", async () => {
    const { author, posts } = await authorWithPosts(Author);
    await harness.exec("INSERT INTO users (id, email) VALUES (2, 'b@example.com')");
    author.email = "b@example.com";
    posts[0]!.markForDestruction();
    posts[1]!.title = "Changed";

    await expect(author.saveOrThrow()).rejects.toThrow(RecordNotUnique);

    expect(posts[0]!.isDestroyed()).toBe(false);
    expect(await titles()).toEqual(["One", "Two"]);
  });

  test("in db.batch, a new owner whose key the database generates can't autosave its records", async () => {
    const author = db().model(Author).build({ email: "a@example.com" });
    author.posts().build({ title: "One" });

    await expect(db().batch((b) => [b.save(author)])).rejects.toThrow(RecordNotSaved);
  });

  test("only the changed records are written", async () => {
    const { author, posts } = await authorWithPosts(Author);
    posts[1]!.title = "Changed";

    await author.saveOrThrow();

    const writes = events.filter(({ sql }) => !sql.startsWith("SELECT"));
    expect(writes).toHaveLength(1);
    expect(writes[0]!.sql).toMatch(/^UPDATE/);
  });

  test("without autosave: true, a changed loaded record isn't saved", async () => {
    const { author, posts } = await authorWithPosts(PlainAuthor);
    posts[0]!.title = "Changed";

    await author.saveOrThrow();

    expect(posts[0]!.isChanged()).toBe(true);
    expect(await titles()).toEqual(["One", "Two"]);
  });

  test("a record found without loading the association isn't saved", async () => {
    await harness.exec("INSERT INTO users (id, email) VALUES (1, 'a@example.com')");
    await harness.exec("INSERT INTO posts (id, user_id, title) VALUES (10, 1, 'One')");
    const author = await db().model(Author).find(1);
    const post = await author.posts().findByOrThrow({ title: "One" });
    post.title = "Changed";

    await author.saveOrThrow();

    expect(await titles()).toEqual(["One"]);
  });

  test("an invalid changed record's errors are copied onto the owner, under the association's name", async () => {
    const { author, posts } = await authorWithPosts(Author);
    posts[0]!.title = "";

    expect(await author.save()).toBe(false);

    expect(posts[0]!.errors.get("title")).toEqual(["can't be blank"]);
    expect(author.errors.get("posts.title")).toEqual(["can't be blank"]);
    expect(author.errors.fullMessages()).toEqual(["Posts title can't be blank"]);
    expect(await titles()).toEqual(["One", "Two"]);
  });

  test("a new record built through it reports its errors the same way", async () => {
    const author = db().model(Author).build({ email: "a@example.com" });
    author.posts().build({ title: "" });

    expect(await author.save()).toBe(false);

    expect(author.errors.toArray()).toEqual([
      { attribute: "posts.title", type: "blank", message: "can't be blank" },
    ]);
  });

  test('a changed record a callback aborts, with no errors to copy, is "is invalid"', async () => {
    const { author, posts } = await authorWithPosts(Author);
    posts[0]!.title = "abort";

    expect(await author.save()).toBe(false);

    expect(author.errors.fullMessages()).toEqual(["Posts is invalid"]);
    expect(await titles()).toEqual(["One", "Two"]);
  });

  test("unchanged loaded records aren't validated", async () => {
    await harness.exec("INSERT INTO users (id, email) VALUES (1, 'a@example.com')");
    await harness.exec("INSERT INTO posts (id, user_id, title) VALUES (10, 1, '')");
    await harness.exec("INSERT INTO posts (id, user_id, title) VALUES (11, 1, 'Two')");
    const author = await db().model(Author).find(1);
    const [blank, other] = await author.posts().toArray();
    other!.title = "Changed";

    expect(await author.save()).toBe(true);
    expect(blank!.errors.isEmpty()).toBe(true);
  });

  test("markForDestruction() marks a record, writing nothing", async () => {
    const { posts } = await authorWithPosts(Author);
    const [post] = posts;
    expect(post!.isMarkedForDestruction()).toBe(false);

    post!.markForDestruction();

    expect(post!.isMarkedForDestruction()).toBe(true);
    expect(events).toHaveLength(0);
  });

  test("reload() clears a record's mark", async () => {
    const { posts } = await authorWithPosts(Author);
    posts[0]!.markForDestruction();

    await posts[0]!.reload();

    expect(posts[0]!.isMarkedForDestruction()).toBe(false);
  });

  test("saving the owner destroys its marked records, and they leave its collection", async () => {
    const { author, posts } = await authorWithPosts(Author);
    posts[0]!.markForDestruction();
    expect(await author.posts().toArray()).toEqual(posts);

    expect(await author.save()).toBe(true);

    expect(posts[0]!.isDestroyed()).toBe(true);
    expect(await titles()).toEqual(["Two"]);
    expect(author.loaded("posts")).toEqual([posts[1]]);
  });

  test("a marked record's destroy runs its callbacks and its dependent: strategies", async () => {
    const { author, posts } = await authorWithPosts(Author);
    await harness.exec("INSERT INTO comments (id, post_id, body) VALUES (1, 10, 'Hi')");
    posts[0]!.markForDestruction();

    await author.saveOrThrow();

    expect(log).toEqual(["destroyed One"]);
    expect(await db().model(Comment).count()).toBe(0);
  });

  test("the marked records are destroyed before the changed ones are saved", async () => {
    const { author, posts } = await authorWithPosts(Author);
    posts[1]!.title = "Changed";
    posts[0]!.markForDestruction();

    await author.saveOrThrow();

    const writes = events.map(({ sql }) => sql.split(" ").slice(0, 3).join(" "));
    expect(writes).toEqual([
      expect.stringMatching(/^DELETE FROM .?comments/),
      expect.stringMatching(/^DELETE FROM .?posts/),
      expect.stringMatching(/^UPDATE .?posts/),
    ]);
  });

  test("a marked record that was never saved is dropped from the collection, and nothing is written", async () => {
    const { author } = await authorWithPosts(Author);
    const post = author.posts().build({ title: "Draft" });
    post.markForDestruction();

    await author.saveOrThrow();

    expect(post.isNewRecord()).toBe(true);
    expect(events).toHaveLength(0);
    expect(await author.posts().toArray()).toHaveLength(2);
  });

  test("without autosave: true, a marked record isn't destroyed", async () => {
    const { author, posts } = await authorWithPosts(PlainAuthor);
    posts[0]!.markForDestruction();

    await author.saveOrThrow();

    expect(posts[0]!.isDestroyed()).toBe(false);
    expect(await titles()).toEqual(["One", "Two"]);
  });

  test("a changed record under an unchanged one is saved, at every level", async () => {
    const { author, posts } = await authorWithPosts(Author);
    await harness.exec("INSERT INTO comments (id, post_id, body) VALUES (1, 10, 'Hi')");
    await harness.exec("INSERT INTO comments (id, post_id, body) VALUES (2, 10, 'Bye')");
    const [hi, bye] = await posts[0]!.comments().toArray();
    hi!.body = "Changed";
    bye!.markForDestruction();

    await author.saveOrThrow();

    expect(posts[0]!.isChanged()).toBe(false);
    expect(await db().model(Comment).pluck("body")).toEqual(["Changed"]);
  });

  test("in db.batch, b.save(owner) writes its changed and marked records, each once", async () => {
    const { author, posts } = await authorWithPosts(Author);
    posts[0]!.markForDestruction();
    posts[1]!.title = "Changed";
    await db().batch((b) => [b.save(author), b.destroy(posts[0]!), b.save(posts[1]!)]);

    expect(events.filter(({ sql }) => sql.startsWith('DELETE FROM "posts"'))).toHaveLength(1);
    expect(events.filter(({ sql }) => sql.startsWith("UPDATE"))).toHaveLength(1);
    expect(await titles()).toEqual(["Changed"]);
  });

  describe("a marked record whose destroy is refused", () => {
    test("save() is false, and nothing is written", async () => {
      const { author, posts } = await authorWithPosts(Author);
      posts[0]!.title = "Pinned";
      posts[0]!.markForDestruction();
      posts[1]!.title = "Changed";

      expect(await author.save()).toBe(false);

      expect(posts[0]!.isDestroyed()).toBe(false);
      expect(events).toHaveLength(0);
      expect(await titles()).toEqual(["One", "Two"]);
    });

    test("saveOrThrow() throws RecordNotDestroyed", async () => {
      const { author, posts } = await authorWithPosts(Author);
      posts[0]!.title = "Pinned";
      posts[0]!.markForDestruction();

      await expect(author.saveOrThrow()).rejects.toThrow(
        new RecordNotDestroyed("pinned posts stay"),
      );
    });

    test("a restrictWithError strategy's error stays on the marked record", async () => {
      const { author, posts } = await authorWithPosts(Moderator);
      await harness.exec("INSERT INTO comments (id, post_id, body) VALUES (1, 10, 'Hi')");
      posts[0]!.markForDestruction();

      expect(await author.save()).toBe(false);

      expect(posts[0]!.errors.fullMessages()).toEqual([
        "Cannot delete record because dependent comments exist",
      ]);
      expect(await titles()).toEqual(["One", "Two"]);
    });

    test("an owner whose own callback refuses keeps pointing at its marked record, and destroys it once saved", async () => {
      await harness.exec("INSERT INTO users (id, email) VALUES (1, 'a@example.com')");
      await harness.exec("INSERT INTO posts (id, user_id, title) VALUES (10, 1, 'One')");
      await harness.exec("INSERT INTO comments (id, post_id, body) VALUES (1, 10, 'abort')");
      const reply = await db().model(Reply).find(1);
      const post = (await reply.post())!;
      post.markForDestruction();

      expect(await reply.save()).toBe(false);
      expect(reply.postId).toBe(10);
      reply.body = "Hi";
      await reply.saveOrThrow();

      expect(post.isDestroyed()).toBe(true);
      expect(await db().model(Post).count()).toBe(0);
    });

    test("a marked record never saved stays in the association when the save is refused", async () => {
      const { author, posts } = await authorWithPosts(Author);
      const draft = author.posts().build({ title: "Draft" });
      draft.markForDestruction();
      posts[0]!.title = "Pinned";
      posts[0]!.markForDestruction();

      expect(await author.save()).toBe(false);

      expect(await author.posts().toArray()).toContain(draft);
    });

    test("on a hasOne, save() is false, and nothing is written", async () => {
      await harness.exec("INSERT INTO users (id, email) VALUES (1, 'a@example.com')");
      await harness.exec("INSERT INTO profiles (id, user_id, bio) VALUES (5, 1, 'Pinned')");
      const author = await db().model(Author).find(1);
      (await author.profile())!.markForDestruction();

      expect(await author.save()).toBe(false);

      expect(await db().model(Profile).count()).toBe(1);
    });

    test("restrictWithException throws DeleteRestriction, writing nothing", async () => {
      const { author, posts } = await authorWithPosts(Locker);
      await harness.exec("INSERT INTO comments (id, post_id, body) VALUES (1, 10, 'Hi')");
      posts[0]!.markForDestruction();

      await expect(author.save()).rejects.toThrow(DeleteRestriction);

      expect(await titles()).toEqual(["One", "Two"]);
    });

    test("on a belongsTo, the owner keeps pointing at it", async () => {
      await harness.exec("INSERT INTO users (id, email) VALUES (1, 'a@example.com')");
      await harness.exec("INSERT INTO posts (id, user_id, title) VALUES (10, 1, 'Pinned')");
      await harness.exec("INSERT INTO comments (id, post_id, body) VALUES (1, 10, 'Hi')");
      const reply = await db().model(Reply).find(1);
      (await reply.post())!.markForDestruction();

      expect(await reply.save()).toBe(false);

      expect(reply.postId).toBe(10);
      expect(await db().model(Reply).pluck("postId")).toEqual([10]);
    });
  });

  describe("on a hasOne", () => {
    /** An author with a stored profile, loaded. */
    async function authorWithProfile() {
      await harness.exec("INSERT INTO users (id, email) VALUES (1, 'a@example.com')");
      await harness.exec("INSERT INTO profiles (id, user_id, bio) VALUES (5, 1, 'Hello')");
      const author = await db().model(Author).find(1);
      const profile = (await author.profile())!;
      events.length = 0;
      return { author, profile };
    }

    test("saving the owner saves its loaded record when it changed", async () => {
      const { author, profile } = await authorWithProfile();
      profile.bio = "Changed";

      await author.saveOrThrow();

      expect(await db().model(Profile).pluck("bio")).toEqual(["Changed"]);
    });

    test("saving the owner destroys its loaded record when it's marked, and it's no longer loaded", async () => {
      const { author, profile } = await authorWithProfile();
      profile.markForDestruction();

      await author.saveOrThrow();

      expect(profile.isDestroyed()).toBe(true);
      expect(await db().model(Profile).count()).toBe(0);
      expect(author.loaded("profile")).toBeNull();
    });
  });

  describe("on a belongsTo", () => {
    /** A reply on a stored post, its post loaded. */
    async function replyOnPost() {
      await harness.exec("INSERT INTO users (id, email) VALUES (1, 'a@example.com')");
      await harness.exec("INSERT INTO posts (id, user_id, title) VALUES (10, 1, 'One')");
      await harness.exec("INSERT INTO comments (id, post_id, body) VALUES (1, 10, 'Hi')");
      const reply = await db().model(Reply).find(1);
      const post = (await reply.post())!;
      events.length = 0;
      return { reply, post };
    }

    test("a new record it points at, then marked, isn't written, and the owner points at nothing", async () => {
      await harness.exec("INSERT INTO users (id, email) VALUES (1, 'a@example.com')");
      await harness.exec("INSERT INTO comments (id, body) VALUES (1, 'Hi')");
      const reply = await db().model(Reply).find(1);
      const post = reply.post.build({ userId: 1, title: "New" });
      post.markForDestruction();

      await reply.saveOrThrow();

      expect(post.isPersisted()).toBe(false);
      expect(await db().model(Post).count()).toBe(0);
      expect(reply.postId).toBeNull();
    });

    /** A stored post with replies 1 and 2, as reply 1 of `model`, its post loaded and marked. */
    async function replyWithMarkedPost<M extends typeof ThreadReply | typeof LockedReply>(
      model: M,
    ) {
      await harness.exec("INSERT INTO users (id, email) VALUES (1, 'a@example.com')");
      await harness.exec("INSERT INTO posts (id, user_id, title) VALUES (10, 1, 'One')");
      await harness.exec("INSERT INTO comments (id, post_id, body) VALUES (1, 10, 'Hi')");
      const reply = await db().model(model).find(1);
      (await reply.post())!.markForDestruction();
      return reply;
    }

    test("the marked record's dependent destroy leaves the owner, which no longer points at it", async () => {
      const reply = await replyWithMarkedPost(ThreadReply);
      await harness.exec("INSERT INTO comments (id, post_id, body) VALUES (2, 10, 'Bye')");

      await reply.saveOrThrow();

      expect(reply.isDestroyed()).toBe(false);
      expect(await db().model(ThreadReply).pluck("id")).toEqual([1]);
      expect(await db().model(Thread).count()).toBe(0);
    });

    test("the marked record's restriction doesn't count the owner", async () => {
      const reply = await replyWithMarkedPost(LockedReply);

      expect(await reply.save()).toBe(true);

      expect(await db().model(LockedThread).count()).toBe(0);
      expect(await db().model(LockedReply).pluck("postId")).toEqual([null]);
    });

    test("the owner still counts for the marked record's other associations to it", async () => {
      await harness.exec("INSERT INTO users (id, email) VALUES (1, 'a@example.com')");
      await harness.exec("INSERT INTO posts (id, user_id, title) VALUES (10, 1, 'One')");
      await harness.exec("INSERT INTO comments (id, post_id, body) VALUES (10, 10, 'Hi')");
      const reply = await db().model(KeyedReply).find(10);
      (await reply.post())!.markForDestruction();

      expect(await reply.save()).toBe(false);

      expect(await db().model(KeyedThread).count()).toBe(1);
    });

    test("in db.batch, a new marked record the batch saves itself stays linked", async () => {
      await harness.exec("INSERT INTO users (id, email) VALUES (1, 'a@example.com')");
      await harness.exec("INSERT INTO comments (id, body) VALUES (1, 'Hi')");
      const reply = await db().model(Reply).find(1);
      // Its key is given, as one batch can't link a key the database generates.
      const post = reply.post.build({ id: 11, userId: 1, title: "New" });
      post.markForDestruction();

      await db().batch((b) => [b.save(post), b.save(reply)]);

      expect(await db().model(Reply).pluck("postId")).toEqual([11]);
      expect(reply.loaded("post")).toBe(post);
    });

    test("a required one whose new record is marked must exist", async () => {
      const reply = db().model(StrictReply).build({ id: 1, body: "Hi" });
      reply.post.build({ userId: 1, title: "New" }).markForDestruction();

      expect(await reply.save()).toBe(false);

      expect(reply.errors.fullMessages()).toEqual(["Post must exist"]);
    });

    test("saving the owner saves its loaded record first when it changed", async () => {
      const { reply, post } = await replyOnPost();
      post.title = "Changed";
      reply.body = "Edited";

      await reply.saveOrThrow();

      expect(events.map(({ sql }) => sql.split(" ")[1])).toEqual(['"posts"', '"comments"']);
      expect(await titles()).toEqual(["Changed"]);
    });

    test("an invalid changed record's errors are copied onto the owner", async () => {
      const { reply, post } = await replyOnPost();
      post.title = "";

      expect(await reply.save()).toBe(false);

      expect(reply.errors.fullMessages()).toEqual(["Post title can't be blank"]);
      expect(await titles()).toEqual(["One"]);
    });

    test("a marked record: the owner's key is cleared and written, then the record is destroyed", async () => {
      const { reply, post } = await replyOnPost();
      post.markForDestruction();

      await reply.saveOrThrow();

      expect(reply.postId).toBeNull();
      expect(post.isDestroyed()).toBe(true);
      expect(await db().model(Post).count()).toBe(0);
      expect(await db().model(Reply).pluck("postId")).toEqual([null]);
      // The post's dependent deleteAll finds no comments: the reply no longer points at it.
      expect(await db().model(Reply).count()).toBe(1);
      expect(await reply.post()).toBeNull();
    });
  });

  test("autosave takes only true: anything else is an InvalidModel", () => {
    class Owner extends Model.define({ id: { type: "integer", null: false } }) {
      static table = "users";

      posts = hasMany(Post, { foreignKey: "userId", autosave: false } as never);
    }

    expect(() => db().model(Owner).build({ id: 1 })).toThrow(
      new InvalidModel('Owner association "posts": autosave takes true'),
    );
  });
});
