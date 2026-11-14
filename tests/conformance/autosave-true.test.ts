import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  abort,
  belongsTo,
  hasMany,
  hasOne,
  InvalidModel,
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

  comments = hasMany(Comment, { foreignKey: "postId", dependent: "deleteAll" });

  static {
    this.afterDestroy((post) => void log.push(`destroyed ${post.title}`));
    this.validates("title", { presence: true });
    this.beforeValidation((post) => {
      if (post.title === "abort") throw abort("not today");
    });
  }
}

/** A comment that saves the post it's on, and destroys it when it's marked. */
class Reply extends Model.define({
  id: { type: "integer", null: false },
  postId: "integer",
  body: "string",
}) {
  static table = "comments";

  post = belongsTo(Post, { foreignKey: "postId", autosave: true, optional: true });
}

class Profile extends Model.define({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  bio: "string",
}) {
  static table = "profiles";
}

class Author extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
}) {
  static table = "users";

  posts = hasMany(Post, { foreignKey: "userId", autosave: true });
  profile = hasOne(Profile, { foreignKey: "userId", autosave: true });
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
  const db = () => harness.connect({ onQuery: (event) => events.push(event) });

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.reset("comments", "profiles", "posts", "users");
    log.length = 0;
    events.length = 0;
  });

  /** An author with two stored posts, its posts loaded. */
  async function authorWithPosts<M extends typeof Author | typeof PlainAuthor>(model: M) {
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

  test("only the changed records are written", async () => {
    const { author, posts } = await authorWithPosts(Author);
    posts[1]!.title = "Changed";

    await author.saveOrThrow();

    const writes = events.filter(({ sql }) => !sql.startsWith("SELECT"));
    expect(writes).toHaveLength(1);
    expect(writes[0]!.sql).toMatch(/^UPDATE/);
  });

  test("guard: without autosave: true, a changed loaded record isn't saved", async () => {
    const { author, posts } = await authorWithPosts(PlainAuthor);
    posts[0]!.title = "Changed";

    await author.saveOrThrow();

    expect(posts[0]!.isChanged()).toBe(true);
    expect(await titles()).toEqual(["One", "Two"]);
  });

  test("guard: a record found without loading the association isn't saved", async () => {
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

  test("guard: unchanged loaded records aren't validated", async () => {
    await harness.exec("INSERT INTO users (id, email) VALUES (1, 'a@example.com')");
    await harness.exec("INSERT INTO posts (id, user_id, title) VALUES (10, 1, '')");
    await harness.exec("INSERT INTO posts (id, user_id, title) VALUES (11, 1, 'Two')");
    const author = await db().model(Author).find(1);
    const [blank, other] = await author.posts().toArray();
    other!.title = "Changed";

    expect(await author.save()).toBe(true);
    expect(blank!.errors.isEmpty()).toBe(true);
  });

  test("markForDestruction() marks a record, writing nothing, and reload() clears the mark", async () => {
    const { posts } = await authorWithPosts(Author);
    const [post] = posts;
    expect(post!.isMarkedForDestruction()).toBe(false);

    post!.markForDestruction();

    expect(post!.isMarkedForDestruction()).toBe(true);
    expect(events).toHaveLength(0);
    await post!.reload();
    expect(post!.isMarkedForDestruction()).toBe(false);
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

  test("guard: without autosave: true, a marked record isn't destroyed", async () => {
    const { author, posts } = await authorWithPosts(PlainAuthor);
    posts[0]!.markForDestruction();

    await author.saveOrThrow();

    expect(posts[0]!.isDestroyed()).toBe(false);
    expect(await titles()).toEqual(["One", "Two"]);
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

    test("guard: saving the owner saves its loaded record when it changed", async () => {
      const { author, profile } = await authorWithProfile();
      profile.bio = "Changed";

      await author.saveOrThrow();

      expect(await db().model(Profile).pluck("bio")).toEqual(["Changed"]);
    });

    test("guard: saving the owner destroys its loaded record when it's marked, and it's no longer loaded", async () => {
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
