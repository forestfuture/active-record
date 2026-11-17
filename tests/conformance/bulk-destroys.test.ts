import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { abort, belongsTo, hasMany, Model } from "../../packages/active-record/src/index.ts";
import type { QueryEvent } from "../../packages/active-record/src/executor.ts";
import { openHarness, type Harness } from "../support/harness.ts";

/** What the destroy callbacks saw, in order. */
const ran: string[] = [];

class Comment extends Model.define({
  id: { type: "integer", null: false },
  postId: "integer",
  body: "string",
}) {
  static table = "comments";

  post = belongsTo(Post, { foreignKey: "postId", optional: true });

  static {
    this.beforeDestroy((comment) => {
      ran.push(`before ${comment.body}`);
      if (comment.body === "keep") throw abort("this comment is kept");
    });
    this.afterDestroy((comment) => void ran.push(`after ${comment.body}`));
  }
}

class Post extends Model.define({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
}) {
  static table = "posts";

  comments = hasMany(Comment, { foreignKey: "postId", dependent: "destroy" });

  static {
    this.afterDestroy((post) => void ran.push(`after ${post.title}`));
  }
}

describe("destroying many records", () => {
  let harness: Harness;
  const queries: QueryEvent[] = [];
  let database: ReturnType<Harness["connect"]>;
  const db = () => database;
  const titles = async () =>
    (await db().model(Post).order({ id: "asc" }).toArray()).map((post) => post.title);
  const bodies = async () =>
    (await db().model(Comment).order({ id: "asc" }).toArray()).map((comment) => comment.body);

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.reset("comments", "posts", "users");
    await harness.exec("INSERT INTO users (id, email) VALUES (1, 'a@example.com')");
    await harness.exec(
      "INSERT INTO posts (id, user_id, title) VALUES (1, 1, 'First'), (2, 1, 'Second'), (3, 1, 'Third')",
    );
    await harness.exec(
      "INSERT INTO comments (id, post_id, body) VALUES (10, 1, 'a'), (11, 1, 'b'), (20, 2, 'c'), (30, 3, 'd')",
    );
    ran.length = 0;
    database = harness.connect({ onQuery: (event) => queries.push(event) });
    queries.length = 0;
  });

  describe("destroyAll", () => {
    test("destroys each record it matches, with its callbacks and dependents", async () => {
      const destroyed = await db()
        .model(Post)
        .where({ id: [1, 2] })
        .order({ id: "asc" })
        .destroyAll();

      expect(destroyed.map((post) => post.title)).toEqual(["First", "Second"]);
      expect(destroyed.every((post) => post.isDestroyed())).toBe(true);
      expect(await titles()).toEqual(["Third"]);
      expect(await bodies()).toEqual(["d"]);
      expect(ran).toContain("after First");
      expect(ran).toContain("after a");
      expect(ran).toContain("after c");
    });
  });
});
