import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  belongsTo,
  hasMany,
  hasOne,
  type HasMany,
  IncompatibleRelation,
  InvalidModel,
  MissingAttribute,
  Model,
  sql,
} from "../../packages/active-record/src/index.ts";
import { connect, type QueryEvent } from "../../packages/d1-record/src/index.ts";
import { createTestDatabase, recordingBatches, type TestDatabase } from "../support/d1.ts";

class User extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
}) {
  static table = "users";

  posts = hasMany(Post, { foreignKey: "userId" });
  profile = hasOne(Profile, { foreignKey: "userId" });
  postsWithComments = hasMany(Post, {
    foreignKey: "userId",
    scope: (q) => q.includes("comments"),
  });
  noPosts = hasMany(Post, { foreignKey: "userId", scope: (q) => q.none() });
  postsByTitle = hasMany(Post, { foreignKey: "userId", scope: (q) => q.order({ title: "desc" }) });
  postTitles = hasMany(Post, { foreignKey: "userId", scope: (q) => q.select("title") });
  laterPosts = hasMany(Post, {
    foreignKey: "userId",
    scope: (q) => q.where(sql`title >= ${"A2"}`),
  });
  ghosts = hasMany(Ghost, { foreignKey: "userId" });
}

class Post extends Model.define({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
  published: "boolean",
}) {
  static table = "posts";

  author = belongsTo(User, { foreignKey: "userId" });
  comments = hasMany(Comment, { foreignKey: "postId" });
  firstComment = hasMany(Comment, { foreignKey: "postId", scope: (q) => q.limit(1) });
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
  bio: "string",
}) {
  static table = "profiles";

  user = belongsTo(User, { foreignKey: "userId" });
}

// Its table, inferred as "ghosts", doesn't exist.
class Ghost extends Model.define({
  id: { type: "integer", null: false },
  userId: "integer",
}) {}

class Account extends Model.define({
  id: { type: "integer", null: false },
  userId: "integer",
}) {
  static table = "accounts";

  user = belongsTo(User, { foreignKey: "userId" });
  namedUser = belongsTo(User, {
    foreignKey: "userId",
    scope: (q) => q.where(sql`email <> ${""}`),
  });
  // A tree of accounts, user_id holding the parent's id: each preloads its own children.
  // Annotated, since the scope names the association it declares.
  children: HasMany<typeof Account> = hasMany(Account, {
    foreignKey: "userId",
    scope: (q) => q.includes("children"),
  });
}

// `relation`, binding 100 values in conditions every record meets: D1 binds at most 100 values
// a statement, and a preload's statement binds the values of the queries above it too.
function bindingHundredValues<R extends { where(condition: ReturnType<typeof sql>): R }>(
  relation: R,
): R {
  const conditions = Array.from({ length: 25 }, (_, index) => -4 * index);
  return conditions.reduce(
    (query, id) => query.where(sql`id NOT IN (${id - 1}, ${id - 2}, ${id - 3}, ${id - 4})`),
    relation,
  );
}

// An includes tree goes to D1 with the records' query, in one round trip (#217).
describe("preloading sends the records' query and its associations together", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;
  // Made afresh for each test, so its batches are that test's.
  let recording: ReturnType<typeof recordingBatches>;
  const queries: QueryEvent[] = [];
  const db = () => connect(recording.binding, { onQuery: (event) => queries.push(event) });
  const titles = (user: User) => user.loaded("posts").map((post) => post.title);

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
  });
  afterAll(() => dispose());
  beforeEach(async () => {
    recording = recordingBatches(binding);
    queries.length = 0;
    await binding.batch([
      binding.prepare("DELETE FROM accounts"),
      binding.prepare("DELETE FROM comments"),
      binding.prepare("DELETE FROM posts"),
      binding.prepare("DELETE FROM profiles"),
      binding.prepare("DELETE FROM users"),
      binding.prepare(
        "INSERT INTO users (id, email) VALUES (1, 'a@example.com'), (2, 'b@example.com'), (3, 'c@example.com')",
      ),
      binding.prepare(
        "INSERT INTO posts (id, user_id, title) VALUES (11, 1, 'A2'), (10, 1, 'A1'), (12, 2, 'B1')",
      ),
      binding.prepare("INSERT INTO profiles (id, user_id, bio) VALUES (1, 2, 'Bee')"),
    ]);
  });

  test("two associations go in one batch with the records' query", async () => {
    const users = await db()
      .model(User)
      .includes("posts", "profile")
      .order({ id: "asc" })
      .toArray();

    expect(recording.batches).toEqual([3]);
    expect(queries).toHaveLength(3);
    expect(users.map(titles)).toEqual([["A1", "A2"], ["B1"], []]);
    expect(users.map((user) => user.loaded("profile")?.bio ?? null)).toEqual([null, "Bee", null]);
  });

  test("one association goes in one batch with the records' query", async () => {
    const users = await db().model(User).includes("posts").order({ id: "asc" }).toArray();

    expect(recording.batches).toEqual([2]);
    expect(queries).toHaveLength(2);
    expect(users.map(titles)).toEqual([["A1", "A2"], ["B1"], []]);
  });

  test("an association with no keys to look up finds nothing, in the same round trip", async () => {
    await binding.prepare("INSERT INTO accounts (id, user_id) VALUES (1, NULL)").run();

    const [account] = await db().model(Account).includes("user").toArray();

    expect(account?.loaded("user")).toBeNull();
    expect(recording.batches).toEqual([2]);
    expect(queries).toHaveLength(2);
  });

  test("every level of a tree goes in the one batch", async () => {
    // User 1 has posts but no profile: the profile's user is looked up all the same.
    const [user] = await db()
      .model(User)
      .includes({ posts: "comments", profile: "user" })
      .where({ id: 1 })
      .toArray();

    expect(user?.loaded("profile")).toBeNull();
    expect(user?.loaded("posts").map((post) => post.loaded("comments"))).toEqual([[], []]);
    expect(recording.batches).toEqual([5]);
    expect(queries).toHaveLength(5);
  });

  test("a hasMany preloaded in a batch keeps its scope's order", async () => {
    const [user] = await db()
      .model(User)
      .includes("postsByTitle", "profile")
      .where({ id: 1 })
      .toArray();

    expect(user?.loaded("postsByTitle").map((post) => post.title)).toEqual(["A2", "A1"]);
    expect(recording.batches).toEqual([3]);
  });

  test("a nested level under owners that found nothing is sent in the same batch", async () => {
    // User 3 has no posts and no profile: the batch is planned before anything is found.
    const [user] = await db()
      .model(User)
      .includes({ posts: "comments", profile: "user" })
      .where({ id: 3 })
      .toArray();

    expect(user?.loaded("posts")).toEqual([]);
    expect(user?.loaded("profile")).toBeNull();
    expect(recording.batches).toEqual([5]);
    expect(queries).toHaveLength(5);
  });

  test("a scope's select() still loads the key its records are matched by", async () => {
    const users = await db().model(User).includes("postTitles").order({ id: "asc" }).toArray();

    const posts = users.map((user) => user.loaded("postTitles"));
    expect(posts.map((own) => own.map((post) => post.title).toSorted())).toEqual([
      ["A1", "A2"],
      ["B1"],
      [],
    ]);
    expect(posts[1]?.[0]?.userId).toBe(2);
    expect(() => posts[1]?.[0]?.published).toThrow(MissingAttribute);
    expect(queries).toHaveLength(2);
  });

  test("a scope's select() still loads the keys its nested includes need", async () => {
    const [user] = await db()
      .model(User)
      .includes({ postTitles: "author" })
      .where({ id: 2 })
      .toArray();

    const [post] = user!.loaded("postTitles");
    expect(post?.title).toBe("B1");
    expect(post?.loaded("author")?.email).toBe("b@example.com");
  });

  test("nested associations in different branches go in the one batch", async () => {
    await binding.prepare("INSERT INTO comments (id, post_id, body) VALUES (1, 12, 'Hm')").run();

    const [user] = await db()
      .model(User)
      .includes({ posts: "comments", profile: "user" })
      .where({ id: 2 })
      .toArray();

    expect(recording.batches).toEqual([5]);
    expect(queries).toHaveLength(5);
    const [post] = user!.loaded("posts");
    expect(post?.loaded("comments").map((comment) => comment.body)).toEqual(["Hm"]);
    expect(user?.loaded("profile")?.loaded("user")?.email).toBe("b@example.com");
  });

  test("an association scope's includes go in the one batch", async () => {
    await binding.prepare("INSERT INTO comments (id, post_id, body) VALUES (1, 12, 'Hm')").run();

    const [user] = await db()
      .model(User)
      .includes("profile", { postsWithComments: "author" })
      .where({ id: 2 })
      .toArray();

    expect(recording.batches).toEqual([5]);
    expect(queries).toHaveLength(5);
    const [post] = user!.loaded("postsWithComments");
    expect(post?.loaded("comments").map((comment) => comment.body)).toEqual(["Hm"]);
    expect(post?.loaded("author")?.email).toBe("b@example.com");
  });

  test("a scope's conditions narrow its level and the level under it, values bound in order", async () => {
    await binding
      .prepare(
        "INSERT INTO comments (id, post_id, body) VALUES (1, 10, 'On A1'), (2, 11, 'On A2'), (3, 12, 'On B1')",
      )
      .run();

    const users = await db()
      .model(User)
      .where(sql`email <= ${"b@example.com"}`)
      .includes({ laterPosts: "comments" })
      .order({ id: "asc" })
      .toArray();

    const comments = users.map((user) =>
      user.loaded("laterPosts").map((post) => post.loaded("comments").map((each) => each.body)),
    );
    expect(comments).toEqual([[["On A2"]], [["On B1"]]]);
    expect(recording.batches).toEqual([3]);
  });

  // D1 binds at most 100 values a statement, and a level binds the values of the levels above.
  test("a level that would bind over 100 values is preloaded after, by its owners' keys", async () => {
    const users = bindingHundredValues(db().model(User))
      .includes("posts", "laterPosts")
      .order({ id: "asc" });

    const loaded = await users.toArray();

    expect(loaded.map((user) => user.loaded("laterPosts").map((post) => post.title))).toEqual([
      ["A2"],
      ["B1"],
      [],
    ]);
    expect(loaded.map(titles)).toEqual([["A1", "A2"], ["B1"], []]);
    expect(recording.batches).toEqual([2]);
    expect(queries).toHaveLength(3);
  });

  test("a level further down over 100 values is preloaded after the levels above it", async () => {
    await binding.prepare("INSERT INTO accounts (id, user_id) VALUES (1, 1), (2, 2)").run();
    const accounts = bindingHundredValues(db().model(Account))
      .includes({ user: "laterPosts" })
      .order({ id: "asc" });

    const loaded = await accounts.toArray();

    const later = loaded.map((account) => account.loaded("user")?.loaded("laterPosts"));
    expect(later.map((posts) => posts?.map((post) => post.title))).toEqual([["A2"], ["B1"]]);
    expect(recording.batches).toEqual([2]);
    expect(queries).toHaveLength(3);
  });

  test("a level over 100 values whose owners have no keys sends nothing more", async () => {
    await binding.prepare("INSERT INTO accounts (id, user_id) VALUES (1, NULL)").run();
    const accounts = bindingHundredValues(db().model(Account));

    const [account] = await accounts.includes("namedUser").toArray();

    expect(account?.loaded("namedUser")).toBeNull();
    expect(queries).toHaveLength(1);
  });

  test("an association scope of none() sends nothing for it", async () => {
    const [user] = await db().model(User).includes("noPosts", "profile").where({ id: 2 }).toArray();

    expect(user?.loaded("noPosts")).toEqual([]);
    expect(user?.loaded("profile")?.bio).toBe("Bee");
    expect(recording.batches).toEqual([2]);
    expect(queries).toHaveLength(2);
  });

  test("a none() scope a level down sends nothing for it", async () => {
    const [user] = await db()
      .model(User)
      .includes({ profile: { user: "noPosts" } })
      .where({ id: 2 })
      .toArray();

    expect(user?.loaded("profile")?.loaded("user")?.loaded("noPosts")).toEqual([]);
    expect(recording.batches).toEqual([3]);
    expect(queries).toHaveLength(3);
  });

  // User 1 has posts and user 3 none: either way, the comments can't be preloaded.
  test.each([1, 3])(
    "a scope that can't be preloaded, a level down, throws before anything is sent (user %i)",
    async (id) => {
      const loading = db().model(User).includes({ posts: "firstComment" }).where({ id }).toArray();

      await expect(loading).rejects.toThrow(IncompatibleRelation);
      expect(queries).toHaveLength(0);
    },
  );

  test("an association scope including itself preloads until a level finds nothing", async () => {
    await binding
      .prepare("INSERT INTO accounts (id, user_id) VALUES (1, NULL), (2, 1), (3, 2)")
      .run();

    const [root] = await db().model(Account).includes("children").where({ id: 1 }).toArray();

    const [child] = root!.loaded("children");
    expect(child?.loaded("children").map((account) => account.id)).toEqual([3]);
    expect(recording.batches).toEqual([2]);
    expect(queries).toHaveLength(4);
  });

  test("an association written out again further down goes in the one batch", async () => {
    const [post] = await db()
      .model(Post)
      .includes({ author: { posts: "author" } })
      .where({ id: 12 })
      .toArray();

    const [again] = post!.loaded("author")!.loaded("posts");
    expect(again?.loaded("author")?.email).toBe("b@example.com");
    expect(recording.batches).toEqual([4]);
  });

  test("a scope including itself, written out a level down too, plans that level and ends", async () => {
    await binding
      .prepare("INSERT INTO accounts (id, user_id) VALUES (1, NULL), (2, 1), (3, 2), (4, 3)")
      .run();

    const [root] = await db()
      .model(Account)
      .includes({ children: "children" })
      .where({ id: 1 })
      .toArray();

    const [grandchild] = root!.loaded("children")[0]!.loaded("children");
    expect(grandchild?.loaded("children").map((account) => account.id)).toEqual([4]);
    expect(recording.batches.slice(0, 1)).toEqual([3]);
  });

  test("a counted page sends its count, its records and their preloads in one batch", async () => {
    const page = await db().model(User).includes("posts").paginate({ perPage: 2 });

    expect(page.records.map(titles)).toEqual([["A1", "A2"], ["B1"]]);
    expect(page.total).toBe(3);
    expect(recording.batches).toEqual([3]);
  });

  test("a page without a count preloads for its records, not the one read past them", async () => {
    const page = await db().model(User).includes("posts").paginate({ perPage: 1, count: false });

    expect(page.records.map(titles)).toEqual([["A1", "A2"]]);
    expect(page.hasNext).toBe(true);
    expect(recording.batches).toEqual([2]);
  });

  test.each([
    ["first", () => db().model(User).includes("posts").first(), ["A1", "A2"]],
    ["find", () => db().model(User).includes("posts").find(2), ["B1"]],
    [
      "findBy",
      () => db().model(User).includes("posts").findBy({ email: "a@example.com" }),
      ["A1", "A2"],
    ],
  ] as const)("%s sends its preloads with it", async (_, finding, expected) => {
    const user = await finding();

    expect(user && titles(user)).toEqual(expected);
    expect(recording.batches).toEqual([2]);
  });

  test("with a Session, the batch goes through the Session", async () => {
    const sessionDb = connect(recording.binding, { session: "first-primary" });

    const users = await sessionDb
      .model(User)
      .includes("posts", "profile")
      .order({ id: "asc" })
      .toArray();

    expect(recording.sessionBatches).toEqual([3]);
    expect(recording.batches).toEqual([]);
    expect(users.map(titles)).toEqual([["A1", "A2"], ["B1"], []]);
  });

  test("a failed batch rejects with D1's error explained", async () => {
    const loading = db().model(User).includes("posts", "ghosts").toArray();

    await expect(loading).rejects.toThrow(InvalidModel);
    await expect(loading).rejects.toThrow(/Ghost's table "ghosts" doesn't exist/);
  });

  test("a failed batch reports each of its statements with D1's error", async () => {
    await db()
      .model(User)
      .includes("posts", "ghosts")
      .toArray()
      .catch(() => {});

    expect(recording.batches).toEqual([3]);
    expect(queries.map((query) => [query.model, query.error !== undefined])).toEqual([
      ["User", true],
      ["Post", true],
      ["Ghost", true],
    ]);
  });
});
