import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { AssociationNotLoaded, IncompatibleRelation } from "../../src/index.ts";
import { Post } from "../fixtures/models/post.ts";
import { Profile } from "../fixtures/models/profile.ts";
import { User } from "../fixtures/models/user.ts";
import type { QueryEvent } from "../../src/executor.ts";
import { openHarness, type Harness } from "../support/harness.ts";

describe("preloading with includes", () => {
  let harness: Harness;
  const queries: QueryEvent[] = [];
  const db = () => harness.connect({ onQuery: (event) => queries.push(event) });

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    queries.length = 0;
    await harness.reset("comments", "posts", "profiles", "users");
    await harness.exec(
      "INSERT INTO users (id, email) VALUES (1, 'a@example.com'), (2, 'b@example.com'), (3, 'c@example.com')",
    );
    await harness.exec(
      "INSERT INTO posts (id, user_id, title) VALUES (10, 1, 'A1'), (11, 1, 'A2'), (12, 2, 'B1')",
    );
    await harness.exec("INSERT INTO profiles (id, user_id, bio) VALUES (1, 2, 'Bee')");
  });

  test("hasMany preloads in one query, and reading it afterwards sends none", async () => {
    const users = await db().model(User).includes("posts").order({ id: "asc" }).toArray();
    expect(queries).toHaveLength(2);
    queries.length = 0;

    const titles = await Promise.all(
      users.map(async (user) => (await user.posts().toArray()).map((post) => post.title)),
    );

    expect(titles).toEqual([["A1", "A2"], ["B1"], []]);
    expect(queries).toHaveLength(0);
  });

  test("belongsTo and hasOne preload too, with null where there's nothing", async () => {
    const posts = await db().model(Post).includes("user").order({ id: "asc" }).toArray();
    const users = await db().model(User).includes("profile").order({ id: "asc" }).toArray();
    expect(queries).toHaveLength(4);
    queries.length = 0;

    const emails = await Promise.all(posts.map(async (post) => (await post.user())?.email));
    const bios = await Promise.all(users.map(async (user) => (await user.profile())?.bio ?? null));

    expect(emails).toEqual(["a@example.com", "a@example.com", "b@example.com"]);
    expect(bios).toEqual([null, "Bee", null]);
    expect(queries).toHaveLength(0);
  });

  test("chaining on a preloaded hasMany queries as normal", async () => {
    const [user] = await db().model(User).includes("posts").where({ id: 1 }).toArray();
    queries.length = 0;

    expect(await user?.posts().where({ title: "A2" }).count()).toBe(1);
    expect(queries).toHaveLength(1);
  });

  test("preloading 250 records takes 2 queries: every key goes in one, as one bound value", async () => {
    const ids = Array.from({ length: 250 }, (_, index) => index + 100);
    await harness.exec(
      `INSERT INTO users (id, email) VALUES ${ids.map((id) => `(${id}, 'u${id}@example.com')`).join(", ")}`,
    );
    await harness.exec(
      `INSERT INTO posts (id, user_id, title) VALUES ${ids.map((id) => `(${id}, ${id}, 'P${id}')`).join(", ")}`,
    );

    const users = await db().model(User).where({ id: ids }).includes("posts").toArray();

    expect(users).toHaveLength(250);
    expect(queries).toHaveLength(2);
    expect(queries.map((query) => query.params.length)).toEqual([1, 1]);
  });

  test("nested includes preload each level in its own query", async () => {
    await harness.exec(
      "INSERT INTO comments (id, post_id, body) VALUES (1, 10, 'Nice'), (2, 10, 'Agreed'), (3, 12, 'Hm')",
    );

    const users = await db()
      .model(User)
      .includes({ posts: "comments" })
      .order({ id: "asc" })
      .toArray();
    expect(queries).toHaveLength(3);
    queries.length = 0;

    const firstPost = (await users[0]!.posts().toArray())[0]!;
    expect((await firstPost.comments().toArray()).map((comment) => comment.body)).toEqual([
      "Nice",
      "Agreed",
    ]);
    expect(queries).toHaveLength(0);
  });

  test("loaded() returns preloaded data synchronously, and throws when it wasn't preloaded", async () => {
    const [preloaded] = await db()
      .model(User)
      .includes("posts", "profile")
      .where({ id: 2 })
      .toArray();
    const [plain] = await db().model(User).where({ id: 2 }).toArray();

    expect(preloaded?.loaded("posts").map((post) => post.title)).toEqual(["B1"]);
    expect((preloaded?.loaded("profile") as Profile | null)?.bio).toBe("Bee");
    expect(() => plain?.loaded("posts")).toThrow(AssociationNotLoaded);
    expect(() => plain?.loaded("posts")).toThrow(/User.*"posts".*includes/);
  });

  test("first, find and findBy preload too", async () => {
    const users = db().model(User).includes("posts");

    const first = await users.order({ id: "asc" }).first();
    const found = await users.find(2);
    const foundBy = await users.findBy({ email: "a@example.com" });

    expect(first?.loaded("posts")).toHaveLength(2);
    expect(found.loaded("posts")).toHaveLength(1);
    expect(foundBy?.loaded("posts")).toHaveLength(2);
  });

  test("find with several ids preloads too, in two queries", async () => {
    const users = await db().model(User).includes("posts").find(2, 1);

    expect(users.map((user) => user.loaded("posts").length)).toEqual([1, 2]);
    expect(queries).toHaveLength(2);
  });

  test("the keys preloading needs are loaded even when select leaves them out", async () => {
    const posts = await db()
      .model(Post)
      .select("title")
      .includes("user")
      .order({ id: "asc" })
      .toArray();

    expect(posts.map((post) => post.loaded("user")?.email)).toEqual([
      "a@example.com",
      "a@example.com",
      "b@example.com",
    ]);
  });

  test("includes on none() sends no queries", async () => {
    expect(await db().model(User).includes("posts").none().toArray()).toEqual([]);
    expect(queries).toHaveLength(0);
  });

  test("or() needs the same includes; merge() combines them", async () => {
    const users = db().model(User);

    expect(() => users.includes("posts").or(users.includes("profile"))).toThrow(
      IncompatibleRelation,
    );
    expect(() => users.includes("posts").or(users.includes("posts"))).not.toThrow();

    const [merged] = await users
      .includes("posts")
      .merge(users.includes("profile"))
      .where({ id: 2 })
      .toArray();
    expect(merged?.loaded("posts")).toHaveLength(1);
    expect(merged?.loaded("profile")?.bio).toBe("Bee");
  });

  test("reload() drops preloaded associations", async () => {
    const user = await db().model(User).includes("posts").find(1);

    await user.reload();

    expect(() => user.loaded("posts")).toThrow(AssociationNotLoaded);
  });

  test("loaded() returns a copy of a preloaded list", async () => {
    const user = await db().model(User).includes("posts").find(1);

    user.loaded("posts").pop();

    expect(user.loaded("posts")).toHaveLength(2);
    expect(await user.posts().toArray()).toHaveLength(2);
  });

  test("includes can't be combined with select(...).distinct(), in either order", () => {
    const posts = db().model(Post);

    expect(() => posts.select("title").distinct().includes("user")).toThrow(IncompatibleRelation);
    expect(() => posts.includes("user").select("title").distinct()).toThrow(/includes.*distinct/);
  });

  test("chaining a scope on a preloaded hasMany queries as normal", async () => {
    const user = await db().model(User).includes("posts").find(1);
    queries.length = 0;

    const titled = await user.posts().titled("A2").toArray();

    expect(titled.map((post) => post.title)).toEqual(["A2"]);
    expect(queries).toHaveLength(1);
  });
});
