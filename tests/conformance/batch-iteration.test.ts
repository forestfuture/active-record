import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { belongsTo, hasMany, Model } from "../../packages/active-record/src/index.ts";
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
  });
});
