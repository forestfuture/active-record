import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  belongsTo,
  hasMany,
  Model,
  sql,
  column,
} from "../../../packages/active-record/src/index.ts";
import { connect, type QueryEvent } from "../../../packages/active-record/src/adapters/d1/index.ts";
import { createTestDatabase, recordingBatches, type TestDatabase } from "../../support/d1.ts";

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
}) {
  static table = "posts";
  static titledAfter = this.scope((q, title: string) =>
    q.where(sql`${column("title")} > ${title}`),
  );

  user = belongsTo(User, { foreignKey: "userId" });
}

describe("paginate", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;
  const events: QueryEvent[] = [];
  // Made afresh for each test, so its batches are that test's.
  let recording: ReturnType<typeof recordingBatches>;
  const db = () => connect(recording.binding, { onQuery: (event) => events.push(event) });
  const titles = (records: readonly Post[]) => records.map((post) => post.title);

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
    // Read backwards for a descending order, the index gives tied rows in reverse key order.
    await binding.prepare("CREATE INDEX posts_user_id ON posts (user_id)").run();
  });
  afterAll(() => dispose());
  beforeEach(async () => {
    await binding.batch([
      binding.prepare("DELETE FROM posts"),
      binding.prepare("DELETE FROM users"),
      binding.prepare("INSERT INTO users (id, email) VALUES (1, 'a@example.com')"),
      binding.prepare(
        "INSERT INTO posts (id, user_id, title) VALUES (5, 1, 'E'), (3, 1, 'C'), (1, 1, 'A'), (4, 1, 'D'), (2, 1, 'B')",
      ),
    ]);
    events.length = 0;
    recording = recordingBatches(binding);
  });

  test("resolves to a page of records and its total, by primary key, in one batch", async () => {
    const page = await db().model(Post).paginate({ page: 2, perPage: 2 });

    expect(titles(page.records)).toEqual(["C", "D"]);
    expect({ ...page, records: undefined }).toEqual({
      records: undefined,
      page: 2,
      perPage: 2,
      total: 5,
      totalPages: 3,
      hasNext: true,
      hasPrevious: true,
    });
    expect(recording.batches).toHaveLength(1);
    expect(events).toHaveLength(2);
  });

  describe("with { count: false }", () => {
    test("fetches one record past the page to learn whether there's a next, in one query", async () => {
      const page = await db().model(Post).paginate({ page: 2, perPage: 2, count: false });

      expect(titles(page.records)).toEqual(["C", "D"]);
      expect({ ...page, records: undefined }).toEqual({
        records: undefined,
        page: 2,
        perPage: 2,
        hasNext: true,
        hasPrevious: true,
      });
      expect(events).toHaveLength(1);
      expect(recording.batches).toHaveLength(0);
    });

    test("preloads includes() for the page's records only, not the one past it", async () => {
      await binding.batch([
        binding.prepare("INSERT INTO users (id, email) VALUES (2, 'b@example.com')"),
        binding.prepare("UPDATE posts SET user_id = 2 WHERE id = 5"),
      ]);

      const posts = db().model(Post).includes("user");
      const counted = await posts.paginate({ page: 2, perPage: 2 });
      const countedPreload = events.at(-1);
      const page = await posts.paginate({ page: 2, perPage: 2, count: false });

      expect(page.records.map((post) => post.loaded("user")?.email)).toEqual([
        "a@example.com",
        "a@example.com",
      ]);
      expect(titles(counted.records)).toEqual(titles(page.records));
      expect(events.at(-1)?.meta?.rows_read).toBe(countedPreload?.meta?.rows_read);
    });
  });

  test("preloads includes() after the page, as toArray() does", async () => {
    const page = await db().model(Post).includes("user").paginate({ perPage: 2 });

    expect(page.records.map((post) => post.loaded("user")?.email)).toEqual([
      "a@example.com",
      "a@example.com",
    ]);
    expect([recording.batches.length, events.length]).toEqual([1, 3]);
  });
});
