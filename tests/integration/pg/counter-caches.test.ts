import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { belongsTo, hasMany, Model } from "../../../packages/active-record/src/index.ts";
import {
  connect,
  type QueryEvent,
} from "../../../packages/active-record/src/adapters/postgresql/index.ts";
import { openPgSchema, type PgSchema } from "../../support/pg.ts";

class Topic extends Model.define({
  id: { type: "integer", null: false },
  repliesCount: "integer",
}) {
  static table = "topics";
  replies = hasMany(Reply);
}

class Reply extends Model.define({
  id: { type: "integer", null: false },
  topicId: "integer",
}) {
  static table = "replies";
  topic = belongsTo(Topic, { counterCache: true, optional: true });
}

/** Categories under a parent, which counts them: a hasMany of its own Model. */
class Category extends Model.define({
  id: { type: "integer", null: false },
  parentId: "integer",
  childrenCount: "integer",
}) {
  static table = "categories";
  children = hasMany(Category, { foreignKey: "parentId" });
  parent = belongsTo(Category, { counterCache: "childrenCount", optional: true });
}

// Postgres runs a statement on a snapshot of its own (READ COMMITTED), so a COUNT sent before a
// DELETE can miss a row another request commits between them. Counting the rows the DELETE
// returns, in the same statement, counts exactly the rows it removed, as Rails does (#61).
describe("a hasMany's bulk removal on Postgres", () => {
  let schema: PgSchema;
  const events: QueryEvent[] = [];
  const topics = () => connect(schema.url, { onQuery: (event) => events.push(event) }).model(Topic);
  const repliesCount = async () =>
    (await schema.pool.query({ text: "SELECT replies_count FROM topics WHERE id = 1" })).rows[0]![
      "replies_count"
    ];

  beforeAll(async () => {
    schema = await openPgSchema([]);
    await schema.pool.query({
      text: "CREATE TABLE topics (id BIGINT PRIMARY KEY, replies_count BIGINT)",
    });
    await schema.pool.query({
      text: "CREATE TABLE replies (id BIGINT PRIMARY KEY, topic_id BIGINT REFERENCES topics (id))",
    });
    await schema.pool.query({
      text: "CREATE TABLE categories (id BIGINT PRIMARY KEY, parent_id BIGINT, children_count BIGINT)",
    });
  });
  afterAll(() => schema.dispose());
  beforeEach(async () => {
    events.length = 0;
    await schema.pool.query({ text: "DELETE FROM replies; DELETE FROM topics" });
    await schema.pool.query({ text: "INSERT INTO topics VALUES (1, 3)" });
    await schema.pool.query({ text: "INSERT INTO replies VALUES (1, 1), (2, 1), (3, 1)" });
  });

  test("removes the rows and counts them out in one statement", async () => {
    const topic = await topics().find(1);
    events.length = 0;

    expect(await topic.replies().deleteAll()).toBe(3);

    expect(events).toHaveLength(1);
    expect(Number(await repliesCount())).toBe(0);
    expect(topic.repliesCount).toBe(0);
  });

  test("delete(records) nullifies and counts them out in one statement", async () => {
    const topic = await topics().find(1);
    const [first] = await topic.replies().toArray();
    events.length = 0;

    await topic.replies().delete(first!);

    expect(events).toHaveLength(1);
    expect([Number(await repliesCount()), topic.repliesCount]).toEqual([2, 2]);
  });

  // In one statement, Postgres changes a row once: a category that's its own parent would be
  // nullified and counted in the same statement, and keep its count.
  test("a hasMany of its own Model counts out a category that's its own parent", async () => {
    await schema.pool.query({ text: "DELETE FROM categories" });
    await schema.pool.query({ text: "INSERT INTO categories VALUES (1, 1, 2), (2, 1, 0)" });
    const categories = connect(schema.url).model(Category);
    const category = await categories.find(1);

    await category.children().deleteAll();

    expect((await categories.find(1)).childrenCount).toBe(0);
  });
});
