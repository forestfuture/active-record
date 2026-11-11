import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { Model, RecordNotUnique } from "../../../packages/active-record/src/index.ts";
import { connect, type QueryEvent } from "../../../packages/active-record/src/adapters/d1/index.ts";
import { createTestDatabase, type TestDatabase } from "../../support/d1.ts";

// Statements on D1 alone: its meta, and a SQLite trigger. The rest are in tests/conformance.
class User extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
}) {
  static table = "users";
}

class Post extends Model.define({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
  published: { type: "boolean", null: false },
}) {
  static table = "posts";
}

describe("statements on D1", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
  });
  afterAll(() => dispose());
  beforeEach(async () => {
    await binding.batch([
      binding.prepare("DELETE FROM posts"),
      binding.prepare("DELETE FROM users"),
    ]);
  });

  test("a constraint on a table the batch doesn't write to isn't pinned on the batch's Model", async () => {
    const db = connect(binding);
    await db.model(User).insert({ id: 1, email: "taken@example.com" });
    // A trigger makes inserting a post also insert a user with a taken email.
    await binding
      .prepare(
        "CREATE TRIGGER post_signs_up AFTER INSERT ON posts BEGIN INSERT INTO users (email) VALUES ('taken@example.com'); END",
      )
      .run();

    try {
      const error: unknown = await db
        .batch((b) => [b.insert(Post, { userId: 1, title: "Hello", published: true })])
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(RecordNotUnique);
      expect(error).toMatchObject({ table: "users", columns: ["email"], attributes: [] });
    } finally {
      await binding.prepare("DROP TRIGGER post_signs_up").run();
    }
  });

  test("onQuery hears once per statement, with D1's meta for each", async () => {
    const events: QueryEvent[] = [];
    const db = connect(binding, { onQuery: (event) => events.push(event) });

    await db.batch((b) => [
      b.insert(User, { id: 1, email: "a@example.com" }),
      b.deleteAll(db.model(User).where({ id: 1 })),
    ]);

    expect(events.map((event) => event.meta?.changes)).toEqual([1, 1]);
    expect(events.every((event) => event.durationMs >= 0 && event.error === undefined)).toBe(true);
  });
});
