import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { column, gte, sql, UnknownAssociation } from "../../packages/active-record/src/index.ts";
import { Comment } from "../fixtures/models/comment.ts";
import { Post } from "../fixtures/models/post.ts";
import { User } from "../fixtures/models/user.ts";
import type { QueryEvent } from "../../packages/active-record/src/executor.ts";
import { openHarness, type Harness } from "../support/harness.ts";

describe("joins", () => {
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
      "INSERT INTO users (id, email, role) VALUES (1, 'a@example.com', 'admin'), (2, 'b@example.com', 'guest'), (3, 'c@example.com', 'admin')",
    );
    await harness.exec(
      "INSERT INTO posts (id, user_id, title) VALUES (10, 1, 'A1'), (11, 1, 'A2'), (12, 2, 'B1')",
    );
    await harness.exec(
      "INSERT INTO comments (id, post_id, body) VALUES (100, 10, 'on A1'), (101, 12, 'on B1'), (102, NULL, 'loose')",
    );
  });

  describe("a belongsTo", () => {
    test("finds only the records with a linked record, in one query", async () => {
      const comments = await db().model(Comment).joins("post").order({ id: "asc" }).toArray();

      expect(comments.map((comment) => comment.body)).toEqual(["on A1", "on B1"]);
      expect(queries).toHaveLength(1);
    });

    test("keeps the Model's own conditions and finders to its own columns", async () => {
      const comments = db().model(Comment).joins("post");

      expect((await comments.where({ id: 101 }).first())?.body).toBe("on B1");
      expect((await comments.last())?.body).toBe("on B1");
      expect(await comments.find(100)).toMatchObject({ id: 100, postId: 10 });
    });
  });

  // Guards: the join is the association's link, whichever side holds the foreign key.
  describe("a hasMany", () => {
    test("finds a record once for each linked record, as Rails does", async () => {
      const users = await db().model(User).joins("posts").order({ id: "asc" }).toArray();

      expect(users.map((user) => user.id)).toEqual([1, 1, 2]);
    });

    test("finds each record once after distinct()", async () => {
      const users = db().model(User).joins("posts").distinct().order({ id: "asc" });

      expect((await users.toArray()).map((user) => user.id)).toEqual([1, 2]);
    });
  });

  test("a hasOne finds only the records with one", async () => {
    await harness.exec("INSERT INTO profiles (id, user_id, bio) VALUES (1, 3, 'Sea')");

    const users = await db().model(User).joins("profile").toArray();

    expect(users.map((user) => user.id)).toEqual([3]);
  });

  describe("nested", () => {
    test("joins the associations of a joined association's Model", async () => {
      const users = db().model(User).joins({ posts: "comments" }).distinct();

      expect((await users.order({ id: "asc" }).toArray()).map((user) => user.id)).toEqual([1, 2]);
    });

    test("takes a list, and several specs at once", async () => {
      await harness.exec("INSERT INTO profiles (id, user_id, bio) VALUES (1, 2, 'Bee')");

      const users = await db()
        .model(User)
        .joins({ posts: ["comments"] }, "profile")
        .toArray();

      expect(users.map((user) => user.id)).toEqual([2]);
    });

    test("joins an association named twice once", async () => {
      const users = db().model(User).joins("posts", { posts: "comments" }).order({ id: "asc" });

      expect((await users.toArray()).map((user) => user.id)).toEqual([1, 2]);
    });
  });

  test("an unknown association throws UnknownAssociation when the query is written", () => {
    // @ts-expect-error: not an association of User
    expect(() => db().model(User).joins("followers")).toThrow(UnknownAssociation);
    // @ts-expect-error: not an association of Post
    expect(() => db().model(User).joins({ posts: "tags" })).toThrow(UnknownAssociation);
  });

  // Guards: tables are named as they're joined, since the first join.
  describe("a table joined twice", () => {
    test("is joined under an alias, so each join keeps its own rows", async () => {
      await harness.exec("INSERT INTO profiles (id, user_id, bio) VALUES (1, 2, 'Bee')");

      const users = db()
        .model(User)
        .joins({ posts: { user: "profile" } });

      expect((await users.toArray()).map((user) => user.id)).toEqual([2]);
    });

    test("takes Rails' alias, the association's plural and the table it's joined to", () => {
      const { sql } = db().model(User).joins({ posts: "user" }).toSql();

      // oxlint-disable-next-line active-record/no-sql-text -- only the SQL shows a table's alias
      expect(sql).toContain(
        'INNER JOIN "users" "users_posts" ON "posts"."user_id" = "users_posts"."id"',
      );
    });
  });

  describe("leftJoins", () => {
    test("keeps the records with no linked record", async () => {
      const comments = await db().model(Comment).leftJoins("post").order({ id: "asc" }).toArray();

      expect(comments.map((comment) => comment.body)).toEqual(["on A1", "on B1", "loose"]);
    });

    test("finds a record once for each linked record, and once with none", async () => {
      const users = await db().model(User).leftJoins("posts").order({ id: "asc" }).toArray();

      expect(users.map((user) => user.id)).toEqual([1, 1, 2, 3]);
    });

    test("nests, keeping the rows each level finds no link for", async () => {
      const users = db().model(User).leftJoins({ posts: "comments" }).order({ id: "asc" });

      expect((await users.toArray()).map((user) => user.id)).toEqual([1, 1, 2, 3]);
    });

    test("is an inner join where joins() names the same association", async () => {
      const users = db().model(User).leftJoins("posts").joins("posts").distinct();

      expect((await users.order({ id: "asc" }).toArray()).map((user) => user.id)).toEqual([1, 2]);
    });
  });

  describe("merging a joined Model's Relation", () => {
    const titlesOf = async (posts: { toArray(): Promise<Post[]> }) =>
      (await posts.toArray()).map((post) => post.title);
    let database: ReturnType<typeof db>;
    beforeEach(() => {
      database = db();
    });
    const posts = () => database.model(Post).joins("user").order({ id: "asc" });
    const users = () => database.model(User);

    test("takes its conditions, on the joined table", async () => {
      expect(await titlesOf(posts().merge(users().where({ role: "admin" })))).toEqual(["A1", "A2"]);
    });

    test("takes its comparisons and whereNot, of its own attributes", async () => {
      expect(await titlesOf(posts().merge(users().where({ id: gte(2) })))).toEqual(["B1"]);
      expect(await titlesOf(posts().merge(users().whereNot({ id: 1 })))).toEqual(["B1"]);
    });

    test("takes its or()", async () => {
      const either = users()
        .where({ id: 1 })
        .or(users().where({ id: 2 }));

      expect(await titlesOf(posts().merge(either))).toEqual(["A1", "A2", "B1"]);
    });

    test("compiles a fragment's column() as the joined Model's", async () => {
      const second = users().where(sql`${column("id")} = ${2}`);

      expect(await titlesOf(posts().merge(second))).toEqual(["B1"]);
    });

    test("finds nothing, with no query, after none()", async () => {
      expect(await posts().merge(users().none()).toArray()).toEqual([]);
      expect(queries).toEqual([]);
    });

    test("takes conditions onto a nested join", async () => {
      const guests = database
        .model(Comment)
        .joins({ post: "user" })
        .merge(users().where({ role: "guest" }));

      expect((await guests.toArray()).map((comment) => comment.body)).toEqual(["on B1"]);
    });

    test("keeps the receiver's own conditions", async () => {
      const admins = posts()
        .where({ title: "A2" })
        .merge(users().where({ role: "admin" }));

      expect(await titlesOf(admins)).toEqual(["A2"]);
    });
  });
});
