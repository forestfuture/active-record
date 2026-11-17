import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  belongsTo,
  hasMany,
  IncompatibleRelation,
  Model,
  withDatabase,
} from "../../packages/active-record/src/index.ts";
import type { QueryEvent } from "../../packages/active-record/src/executor.ts";
import { openHarness, type Harness } from "../support/harness.ts";

class User extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
}) {
  static table = "users";

  posts = hasMany(Post, { foreignKey: "userId" });
}

class Post extends Model.define({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
  published: { type: "boolean", null: false },
}) {
  static table = "posts";

  user = belongsTo(User, { foreignKey: "userId" });
}

/** Posts newest first, by a default scope's order. */
class NewestPost extends Post {
  static {
    this.defaultScope((q) => q.order({ id: "desc" }));
  }
}

/** Every value an async iterable yields, in order. */
async function collect<T>(iterable: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of iterable) values.push(value);
  return values;
}

describe("batch iteration", () => {
  let harness: Harness;
  const events: QueryEvent[] = [];
  const db = () => harness.connect({ onQuery: (event) => events.push(event) });
  const ids = (records: readonly Post[]) => records.map((post) => post.id);

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.reset("comments", "posts", "users");
    await harness.exec("INSERT INTO users (id, email) VALUES (1, 'a@example.com')");
    await harness.exec(
      "INSERT INTO posts (id, user_id, title, published) VALUES " +
        "(5, 1, 'E', 1), (3, 1, 'C', 0), (7, 1, 'G', 1), (1, 1, 'A', 1), " +
        "(4, 1, 'D', 0), (6, 1, 'F', 1), (2, 1, 'B', 1)",
    );
    events.length = 0;
  });

  describe("findEach", () => {
    test("visits every record once, in primary-key order, a batch per query", async () => {
      const posts = await collect(db().model(Post).findEach({ batchSize: 3 }));

      expect(ids(posts)).toEqual([1, 2, 3, 4, 5, 6, 7]);
      expect(events).toHaveLength(3);
    });

    test("keeps the Relation's conditions across batches", async () => {
      const posts = await collect(
        db().model(Post).where({ published: true }).findEach({ batchSize: 2 }),
      );

      expect(ids(posts)).toEqual([1, 2, 5, 6, 7]);
    });

    test("preloads each batch's includes", async () => {
      const posts = await collect(db().model(Post).includes("user").findEach({ batchSize: 3 }));
      events.length = 0;
      const emails = await Promise.all(posts.map(async (post) => (await post.user())?.email));

      expect(new Set(emails)).toEqual(new Set(["a@example.com"]));
      expect(events).toEqual([]);
    });

    test("is a static of every Model, on the current database", async () => {
      const posts = await withDatabase(db(), () => collect(Post.findEach({ batchSize: 4 })));

      expect(ids(posts)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    });
  });

  describe("findInBatches", () => {
    test("yields arrays of up to batchSize records, in primary-key order", async () => {
      const batches = await collect(db().model(Post).findInBatches({ batchSize: 3 }));

      expect(batches.map(ids)).toEqual([[1, 2, 3], [4, 5, 6], [7]]);
    });

    test("sends one more query, which finds nothing, when the last batch is full", async () => {
      const batches = await collect(db().model(Post).findInBatches({ batchSize: 7 }));

      expect(batches.map(ids)).toEqual([[1, 2, 3, 4, 5, 6, 7]]);
      expect(events).toHaveLength(2);
    });
  });

  describe("start, finish and order", () => {
    test("start and finish bound the primary key, both included", async () => {
      const posts = await collect(db().model(Post).findEach({ batchSize: 2, start: 3, finish: 6 }));

      expect(ids(posts)).toEqual([3, 4, 5, 6]);
    });

    test('order: "desc" goes from the largest key down', async () => {
      const batches = await collect(
        db().model(Post).findInBatches({ batchSize: 3, order: "desc" }),
      );

      expect(batches.map(ids)).toEqual([[7, 6, 5], [4, 3, 2], [1]]);
    });

    test("descending, start is the largest key and finish the smallest", async () => {
      const posts = await collect(
        db().model(Post).findEach({ batchSize: 2, order: "desc", start: 6, finish: 3 }),
      );

      expect(ids(posts)).toEqual([6, 5, 4, 3]);
    });
  });

  describe("what it refuses", () => {
    test("a Relation's own order, when it's called", () => {
      const ordered = db().model(Post).order({ title: "asc" });

      expect(() => ordered.findEach()).toThrow(IncompatibleRelation);
      expect(() => ordered.findInBatches()).toThrow(/reorder\(\)/);
    });

    test("a default scope's order, until reorder() removes it", async () => {
      expect(() => db().model(NewestPost).findEach()).toThrow(IncompatibleRelation);

      const posts = await collect(db().model(NewestPost).reorder().findEach({ batchSize: 5 }));
      expect(ids(posts)).toEqual([1, 2, 3, 4, 5, 6, 7]);
    });

    test("an offset", () => {
      expect(() => db().model(Post).offset(2).findEach()).toThrow(IncompatibleRelation);
    });

    test("distinct() with a select() that leaves out the primary key", async () => {
      const distinct = db().model(Post).select("title").distinct();
      expect(() => distinct.findEach()).toThrow(IncompatibleRelation);

      const titles = await collect(db().model(Post).select("title").findEach({ batchSize: 4 }));
      expect(titles.map((post) => post.title)).toEqual(["A", "B", "C", "D", "E", "F", "G"]);
    });

    test.each([0, -1, 1.5, Number.NaN, "3"])("a batchSize of %s", (batchSize) => {
      expect(() =>
        db()
          .model(Post)
          .findEach({ batchSize: batchSize as number }),
      ).toThrow(TypeError);
    });

    test("an order other than asc or desc", () => {
      expect(() =>
        db()
          .model(Post)
          .findEach({ order: "up" as "asc" }),
      ).toThrow(TypeError);
    });
  });

  describe("limit", () => {
    test("caps the records, the last batch only as large as what's left", async () => {
      const batches = await collect(db().model(Post).limit(5).findInBatches({ batchSize: 2 }));

      expect(batches.map(ids)).toEqual([[1, 2], [3, 4], [5]]);
      expect(events).toHaveLength(3);
    });

    test("stops without another query once the limit is reached", async () => {
      const posts = await collect(db().model(Post).limit(4).findEach({ batchSize: 2 }));

      expect(ids(posts)).toEqual([1, 2, 3, 4]);
      expect(events).toHaveLength(2);
    });

    test("limit(0) sends no query", async () => {
      expect(await collect(db().model(Post).limit(0).findEach())).toEqual([]);
      expect(events).toEqual([]);
    });
  });

  describe("joins and none()", () => {
    const userIds = (users: readonly User[]) => users.map((user) => user.id);

    beforeEach(async () => {
      await harness.exec(
        "INSERT INTO users (id, email) VALUES (2, 'b@example.com'), (3, 'c@example.com')",
      );
      await harness.exec(
        "INSERT INTO posts (id, user_id, title, published) VALUES (8, 2, 'H', 1), (9, 2, 'I', 1)",
      );
      events.length = 0;
    });

    test("a hasMany join yields each record once, across batch boundaries", async () => {
      const users = await collect(db().model(User).joins("posts").findEach({ batchSize: 2 }));

      expect(userIds(users)).toEqual([1, 2]);
    });

    test("a left join keeps the records without a link", async () => {
      const batches = await collect(
        db().model(User).leftJoins("posts").findInBatches({ batchSize: 3 }),
      );

      expect(batches.flat().map((user) => user.id)).toEqual([1, 2, 3]);
    });

    test("a joined Relation's limit counts records, not joined rows", async () => {
      const users = await collect(
        db().model(User).joins("posts").limit(2).findEach({ batchSize: 3 }),
      );

      expect(userIds(users)).toEqual([1, 2]);
    });

    test("none() yields nothing and sends no query", async () => {
      expect(await collect(db().model(Post).none().findInBatches())).toEqual([]);
      expect(events).toEqual([]);
    });
  });
});
