import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  AssociationNotLoaded,
  belongsTo,
  hasMany,
  hasOne,
  Model,
  type Relation,
  type ScopeStatic,
  withDatabase,
} from "../../src/index.ts";
import type { QueryEvent } from "../../src/executor.ts";
import { openHarness, type Harness } from "../support/harness.ts";
import { holdStatements, reads } from "../support/hold-statements.ts";

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

  // Starts again from the Model's statics, so the Relation it returns has no owner.
  static titled: ScopeStatic<[string]> = this.scope((_q, title: string) => Post.where({ title }));

  static {
    this.validates("title", { presence: true });
  }
}

class Comment extends Model.define({
  id: { type: "integer", null: false },
  postId: "integer",
}) {
  static table = "comments";

  post = belongsTo(Post, { foreignKey: "postId" });
}

class Profile extends Model.define({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  bio: "string",
}) {
  static table = "profiles";
}

describe("caching lazily loaded associations", () => {
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
      "INSERT INTO posts (id, user_id, title) VALUES (11, 1, 'A2'), (10, 1, 'A1'), (12, 2, 'B1')",
    );
    await harness.exec("INSERT INTO profiles (id, user_id, bio) VALUES (1, 1, 'Ay')");
    queries.length = 0;
  });

  test("belongsTo and hasOne query once, then answer from the record", async () => {
    const post = await db().model(Post).find(10);
    const user = await db().model(User).find(1);
    queries.length = 0;

    const author = await post.author();
    expect(await post.author()).toBe(author);
    expect(await user.profile()).toBe(await user.profile());

    expect(queries).toHaveLength(2);
  });

  test("a null result is cached too", async () => {
    const user = await db().model(User).find(2);
    queries.length = 0;

    expect(await user.profile()).toBeNull();
    expect(await user.profile()).toBeNull();

    expect(queries).toHaveLength(1);
  });

  test("a belongsTo with no key reads as null without a query, and counts as loaded", async () => {
    const comment = db().model(Comment).build({ postId: null });

    expect(await comment.post()).toBeNull();
    expect(comment.isLoaded("post")).toBe(true);
    expect(comment.loaded("post")).toBeNull();
    expect(queries).toHaveLength(0);
  });

  test("hasMany toArray() loads once, in target primary-key order, then answers from the record", async () => {
    const user = await db().model(User).find(1);
    queries.length = 0;

    const first = await user.posts().toArray();
    const second = await user.posts().toArray();

    expect(first.map((post) => post.id)).toEqual([10, 11]);
    expect(second).toEqual(first);
    expect(queries).toHaveLength(1);
  });

  test("on a loaded hasMany, first, last, take and pluck answer without a query; count still queries", async () => {
    const user = await db().model(User).find(1);
    await user.posts().toArray();
    queries.length = 0;

    expect((await user.posts().first())?.id).toBe(10);
    expect((await user.posts().last())?.id).toBe(11);
    expect((await user.posts().take())?.id).toBe(10);
    expect(await user.posts().pluck("title")).toEqual(["A1", "A2"]);
    expect(queries).toHaveLength(0);

    expect(await user.posts().count()).toBe(2);
    expect(queries).toHaveLength(1);
  });

  test("chaining on a loaded hasMany queries, and doesn't change what's cached", async () => {
    const user = await db().model(User).find(1);
    await user.posts().toArray();
    queries.length = 0;

    expect(await user.posts().where({ title: "A2" }).pluck("id")).toEqual([11]);
    expect(await user.posts().pluck("id")).toEqual([10, 11]);
    expect(queries).toHaveLength(1);
  });

  test("isLoaded() and loaded() see lazy loads as well as preloads", async () => {
    const post = await db().model(Post).find(10);

    expect(post.isLoaded("author")).toBe(false);
    expect(() => post.loaded("author")).toThrow(AssociationNotLoaded);

    await post.author();

    expect(post.isLoaded("author")).toBe(true);
    expect(post.loaded("author")?.id).toBe(1);
    expect((await db().model(Post).includes("author").find(10)).isLoaded("author")).toBe(true);
  });

  test("changing the foreign key makes the cached association stale, so the next read queries", async () => {
    const post = await db().model(Post).find(10);
    await post.author();
    queries.length = 0;

    post.userId = 2;

    expect(post.isLoaded("author")).toBe(false);
    expect((await post.author())?.id).toBe(2);
    expect(queries).toHaveLength(1);
  });

  test("…preloaded associations too", async () => {
    const post = await db().model(Post).includes("author").find(10);
    queries.length = 0;

    post.userId = 2;

    expect((await post.author())?.id).toBe(2);
    expect(queries).toHaveLength(1);
  });

  test("reload() clears the cache; save() keeps it", async () => {
    const post = await db().model(Post).find(10);
    await post.author();

    await post.updateOrThrow({ title: "Renamed" });
    expect(post.isLoaded("author")).toBe(true);

    await post.reload();
    expect(post.isLoaded("author")).toBe(false);
  });

  test("create through a loaded hasMany appends the new record", async () => {
    const user = await db().model(User).find(1);
    await user.posts().toArray();

    const created = await user.posts().createOrThrow({ title: "A3" });
    queries.length = 0;

    expect((await user.posts().toArray()).at(-1)).toBe(created);
    expect(queries).toHaveLength(0);
  });

  test("create through a narrowed association appends too, as Rails' association relation does", async () => {
    const user = await db().model(User).find(1);
    await user.posts().toArray();

    const created = await user.posts().where({ title: "A3" }).createOrThrow();
    queries.length = 0;

    expect((await user.posts().toArray()).at(-1)).toBe(created);
    expect(queries).toHaveLength(0);
  });

  test("a statement built through a hasMany clears the owner's loaded collection when its batch is written", async () => {
    const database = db();
    const user = await database.model(User).find(1);
    const statement = user.posts().toUpdateAll({ title: "Changed" });
    await user.posts().toArray();

    await database.batch([statement]);

    expect(user.isLoaded("posts")).toBe(false);
    expect(await user.posts().pluck("title")).toEqual(["Changed", "Changed"]);
  });

  test("a create that doesn't save doesn't join the loaded records", async () => {
    const user = await db().model(User).find(1);
    await user.posts().toArray();

    const invalid = await user.posts().create({ title: "" });

    expect(invalid.isPersisted()).toBe(false);
    expect(await user.posts().pluck("id")).toEqual([10, 11]);
  });

  test("statements built through a hasMany clear its cache", async () => {
    const user = await db().model(User).find(1);
    await user.posts().toArray();

    await user.posts().updateAll({ title: "Changed" });
    queries.length = 0;

    expect(await user.posts().pluck("title")).toEqual(["Changed", "Changed"]);
    expect(queries).toHaveLength(1);
  });

  test.each([
    [
      "updateAll",
      (user: User) => user.posts().where({ title: "A2" }).updateAll({ title: "B" }),
      ["A1", "B"],
    ],
    ["deleteAll", (user: User) => user.posts().where({ title: "A2" }).deleteAll(), ["A1"]],
    [
      "insert",
      (user: User) => user.posts().where({ title: "A2" }).insert({ id: 13, title: "A3" }),
      ["A1", "A2", "A3"],
    ],
    [
      "upsert",
      (user: User) => user.posts().where({ title: "A2" }).upsert({ id: 11, title: "Up" }),
      ["A1", "Up"],
    ],
  ])("%s through a narrowed hasMany clears its cache", async (_write, write, titles) => {
    const user = await db().model(User).find(1);
    await user.posts().toArray();

    await write(user);

    expect(await user.posts().pluck("title")).toEqual(titles);
  });

  test.each([
    ["or()", (left: Relation<Post>, user: User) => left.or(user.posts()), ["B", "B"]],
    ["merge()", (left: Relation<Post>, user: User) => left.merge(user.posts()), ["A1", "B"]],
  ])(
    "a write with a hasMany on the right of %s clears the hasMany's loaded collection",
    async (_join, join, titles) => {
      const database = db();
      const user = await database.model(User).find(1);
      await user.posts().toArray();

      await join(database.model(Post).where({ title: "A2" }), user).updateAll({ title: "B" });

      expect(await user.posts().pluck("title")).toEqual(titles);
    },
  );

  test("a create with a hasMany on the right of merge() clears the hasMany's loaded collection", async () => {
    const database = db();
    const user = await database.model(User).find(1);
    await user.posts().toArray();

    const created = await database
      .model(Post)
      .where({ title: "A3" })
      .merge(user.posts())
      .createOrThrow();

    expect(created.userId).toBe(1);
    expect(user.isLoaded("posts")).toBe(false);
    expect(await user.posts().pluck("title")).toEqual(["A1", "A2", "A3"]);
  });

  test("a write through or() of two owners' hasManys clears both loaded collections", async () => {
    const database = db();
    const first = await database.model(User).find(1);
    const second = await database.model(User).find(2);
    await first.posts().toArray();
    await second.posts().toArray();

    await first.posts().or(second.posts()).updateAll({ title: "B" });

    expect(first.isLoaded("posts")).toBe(false);
    expect(second.isLoaded("posts")).toBe(false);
  });

  test("a write through a scope that starts a new query clears the hasMany's loaded collection", async () => {
    const database = db();
    const user = await database.model(User).find(1);
    await user.posts().toArray();

    await withDatabase(database, () => user.posts().titled("A2").updateAll({ title: "B" }));

    expect(await user.posts().pluck("title")).toEqual(["A1", "B"]);
  });

  test("reloadAssociation() queries again and returns the fresh value", async () => {
    const user = await db().model(User).find(1);
    const post = await db().model(Post).find(10);
    await user.posts().toArray();
    await post.author();
    await harness.exec("UPDATE users SET email = 'new@example.com' WHERE id = 1");
    await harness.exec("INSERT INTO posts (id, user_id, title) VALUES (13, 1, 'A3')");
    queries.length = 0;

    expect((await post.reloadAssociation("author"))?.email).toBe("new@example.com");
    expect((await user.reloadAssociation("posts")).map((each) => each.id)).toEqual([10, 11, 13]);
    expect(queries).toHaveLength(2);
    expect(user.loaded("posts")).toHaveLength(3);
  });

  test("a belongsTo read answered after set() leaves set()'s record loaded", async () => {
    const {
      db: database,
      arm,
      held,
      release,
    } = holdStatements(harness, reads("users"), "afterRunning");
    const post = await database.model(Post).find(10);
    const other = await database.model(User).find(2);
    arm();

    const reading = post.author();
    await held;
    post.author.set(other);
    release();

    expect((await reading)?.id).toBe(1);
    expect(post.loaded("author")).toBe(other);
  });

  test("a belongsTo read answered after set(null) leaves it loaded as null", async () => {
    const {
      db: database,
      arm,
      held,
      release,
    } = holdStatements(harness, reads("users"), "afterRunning");
    const post = await database.model(Post).find(10);
    arm();

    const reading = post.author();
    await held;
    post.author.set(null);
    release();

    expect((await reading)?.id).toBe(1);
    expect(post.loaded("author")).toBeNull();
  });

  test("a hasOne read answered after build() leaves the built record loaded", async () => {
    const {
      db: database,
      arm,
      held,
      release,
    } = holdStatements(harness, reads("profiles"), "afterRunning");
    const user = await database.model(User).find(1);
    arm();

    const reading = user.profile();
    await held;
    const built = user.profile.build({ bio: "New" });
    release();

    expect((await reading)?.id).toBe(1);
    expect(user.loaded("profile")).toBe(built);
  });

  test("a hasOne read answered after create() leaves the created record loaded", async () => {
    const {
      db: database,
      arm,
      held,
      release,
    } = holdStatements(harness, reads("profiles"), "afterRunning");
    const user = await database.model(User).find(2);
    arm();

    const reading = user.profile();
    await held;
    const created = await user.profile.createOrThrow({ bio: "New" });
    release();

    expect(await reading).toBeNull();
    expect(user.loaded("profile")).toBe(created);
  });

  test("a hasOne read answered after reload() leaves nothing loaded", async () => {
    const {
      db: database,
      arm,
      held,
      release,
    } = holdStatements(harness, reads("profiles"), "afterRunning");
    const user = await database.model(User).find(1);
    arm();

    const reading = user.profile();
    await held;
    await user.reload();
    release();

    expect((await reading)?.id).toBe(1);
    expect(user.isLoaded("profile")).toBe(false);
  });

  test("a record with no key yet doesn't cache its hasMany", async () => {
    const user = db().model(User).build({ email: "new@example.com" });

    expect(await user.posts().toArray()).toEqual([]);
    expect(user.isLoaded("posts")).toBe(false);
  });
});
