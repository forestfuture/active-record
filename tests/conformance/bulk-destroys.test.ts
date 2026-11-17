import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  abort,
  belongsTo,
  hasMany,
  Model,
  RecordNotDestroyed,
  RecordNotFound,
  withDatabase,
} from "../../packages/active-record/src/index.ts";
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

/** The same posts, whose comments nothing destroys with them. */
class PlainPost extends Model.define({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
}) {
  static table = "posts";

  comments = hasMany(Comment, { foreignKey: "postId" });
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

    test("throws RecordNotDestroyed and destroys nothing if one record refuses", async () => {
      await harness.exec("UPDATE comments SET body = 'keep' WHERE id = 20");
      const relation = db()
        .model(Post)
        .where({ id: [1, 2] });

      await expect(relation.destroyAll()).rejects.toThrow(RecordNotDestroyed);

      expect(await titles()).toEqual(["First", "Second", "Third"]);
      expect(await bodies()).toEqual(["a", "b", "keep", "d"]);
      expect(ran.filter((step) => step.startsWith("after"))).toEqual([]);
    });

    test("sends nothing and resolves to [] on none()", async () => {
      expect(await db().model(Post).none().destroyAll()).toEqual([]);

      expect(queries).toEqual([]);
    });

    test("resolves to [] after one read when nothing matches", async () => {
      expect(await db().model(Post).where({ id: 99 }).destroyAll()).toEqual([]);

      expect(queries).toHaveLength(1);
      expect(await titles()).toEqual(["First", "Second", "Third"]);
    });

    describe("through a hasMany", () => {
      test("on the association itself, destroys every record and leaves it loaded and empty", async () => {
        const post = await db().model(PlainPost).find(1);
        await post.comments().toArray();
        const built = post.comments().build({ body: "new" });

        const destroyed = await post.comments().destroyAll();

        expect(destroyed.map((comment) => comment.body)).toEqual(["a", "b", "new"]);
        // A record that was never saved just leaves the association, as in Rails.
        expect(built.isNewRecord()).toBe(true);
        expect(await bodies()).toEqual(["c", "d"]);
        queries.length = 0;
        expect(await post.comments().toArray()).toEqual([]);
        expect(queries).toEqual([]);
      });

      test("narrowed, destroys its records and clears what the owner loaded", async () => {
        const post = await db().model(PlainPost).find(1);
        await post.comments().toArray();

        await post.comments().where({ body: "a" }).destroyAll();

        queries.length = 0;
        const left = await post.comments().toArray();
        expect(left.map((comment) => comment.body)).toEqual(["b"]);
        expect(queries).toHaveLength(1);
      });
    });
  });

  test("destroyBy destroys the records matching its conditions, with their callbacks", async () => {
    const destroyed = await db().model(Comment).destroyBy({ postId: 1 });

    expect(destroyed.map((comment) => comment.body)).toEqual(expect.arrayContaining(["a", "b"]));
    expect(destroyed).toHaveLength(2);
    expect(await bodies()).toEqual(["c", "d"]);
    expect(ran).toContain("after a");
  });

  test("deleteBy deletes the rows matching its conditions, without callbacks", async () => {
    expect(await db().model(Comment).deleteBy({ postId: 1 })).toBe(2);

    expect(await bodies()).toEqual(["c", "d"]);
    expect(ran).toEqual([]);
  });

  describe("as a Model's statics, on the current database", () => {
    test("destroyAll destroys every record", async () => {
      const destroyed = await withDatabase(db(), () => Comment.destroyAll());

      expect(destroyed).toHaveLength(4);
      expect(await bodies()).toEqual([]);
    });

    test("destroyBy destroys the records matching its conditions", async () => {
      const destroyed = await withDatabase(db(), () => Comment.destroyBy({ id: 11 }));

      expect(destroyed.map((comment) => comment.body)).toEqual(["b"]);
      expect(await bodies()).toEqual(["a", "c", "d"]);
    });

    test("deleteBy deletes the rows matching its conditions", async () => {
      expect(await withDatabase(db(), () => Comment.deleteBy({ id: 10 }))).toBe(1);

      expect(await bodies()).toEqual(["b", "c", "d"]);
    });
  });

  describe("by primary key, as a Model's statics", () => {
    const inDatabase = <T>(run: () => Promise<T>) => withDatabase(db(), run);

    test("destroy(id) destroys the record with that key, and resolves to it", async () => {
      const destroyed = await inDatabase(() => Comment.destroy(10));

      expect(destroyed.body).toBe("a");
      expect(destroyed.isDestroyed()).toBe(true);
      expect(ran).toEqual(["before a", "after a"]);
      expect(await bodies()).toEqual(["b", "c", "d"]);
    });

    test("destroy(ids) destroys them together, and resolves to them in order", async () => {
      const destroyed = await inDatabase(() => Comment.destroy([20, 10]));

      expect(destroyed.map((comment) => comment.body)).toEqual(["c", "a"]);
      expect(await bodies()).toEqual(["b", "d"]);
    });

    test("destroy throws RecordNotFound for a missing key, destroying nothing", async () => {
      await expect(inDatabase(() => Comment.destroy([10, 99]))).rejects.toThrow(RecordNotFound);

      expect(ran).toEqual([]);
      expect(await bodies()).toEqual(["a", "b", "c", "d"]);
    });

    test("destroy throws RecordNotDestroyed when one refuses, destroying nothing", async () => {
      await harness.exec("UPDATE comments SET body = 'keep' WHERE id = 11");

      await expect(inDatabase(() => Comment.destroy([10, 11]))).rejects.toThrow(RecordNotDestroyed);

      expect(await bodies()).toEqual(["a", "keep", "c", "d"]);
    });

    test("delete(id) deletes the row without callbacks, and resolves to how many", async () => {
      expect(await inDatabase(() => Comment.delete(10))).toBe(1);

      expect(ran).toEqual([]);
      expect(await bodies()).toEqual(["b", "c", "d"]);
    });

    test("delete(ids) deletes the rows there are, and resolves to how many", async () => {
      expect(await inDatabase(() => Comment.delete([11, 20, 99]))).toBe(2);

      expect(await bodies()).toEqual(["a", "d"]);
    });
  });
});
