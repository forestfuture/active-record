import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { createTestDatabase, type TestDatabase } from "../../support/d1.ts";

// Proves the D1 test harness honours the platform behaviour the library relies on.
describe("D1 test harness", () => {
  let db: TestDatabase;
  let dispose: () => Promise<void>;

  beforeAll(async () => {
    ({ db, dispose } = await createTestDatabase());
  });
  afterAll(() => dispose());

  test("hydrates generated primary keys with RETURNING", async () => {
    const row = await db
      .prepare("INSERT INTO users (email) VALUES (?) RETURNING id")
      .bind("a@example.com")
      .first<{ id: number }>();
    expect(row?.id).toBeTypeOf("number");
  });

  test("enforces unique constraints", async () => {
    await expect(
      db.prepare("INSERT INTO users (email) VALUES (?)").bind("a@example.com").run(),
    ).rejects.toThrow(/UNIQUE constraint failed: users\.email/);
  });

  test("enforces foreign keys", async () => {
    await expect(
      db.prepare("INSERT INTO posts (user_id, title) VALUES (?, ?)").bind(9999, "Orphan").run(),
    ).rejects.toThrow(/FOREIGN KEY constraint failed/);
  });

  test("rolls back a failing batch atomically", async () => {
    await expect(
      db.batch([
        db.prepare("INSERT INTO users (email) VALUES (?)").bind("b@example.com"),
        db.prepare("INSERT INTO users (email) VALUES (?)").bind("a@example.com"),
      ]),
    ).rejects.toThrow();
    const count = await db
      .prepare("SELECT count(*) AS n FROM users WHERE email = ?")
      .bind("b@example.com")
      .first<{ n: number }>("n");
    expect(count).toBe(0);
  });
});
