import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { belongsTo, hasMany, Model } from "../../packages/active-record/src/index.ts";
import { connect, NoSession } from "../../packages/active-record/src/adapters/d1/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

class User extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  role: "string",
}) {
  static table = "users";

  posts = hasMany(Post, { foreignKey: "userId" });

  static {
    this.validates("email", { uniqueness: true });
  }
}

class Post extends Model.define({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
}) {
  static table = "posts";

  author = belongsTo(User, { foreignKey: "userId" });
}

// Miniflare's D1 has no replicas, so read-your-writes itself can't be observed here: these tests
// show that every read and write goes through the one Session. Replica behavior belongs to the
// remote smoke suite (#8).
describe("sessions", () => {
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

  test("with a session, a reload right after a save sees the write", async () => {
    const db = connect(binding, { session: "first-primary" });
    const user = await db.model(User).createOrThrow({ email: "a@example.com" });

    user.role = "admin";
    await user.saveOrThrow();
    user.role = "changed in memory";
    await user.reload();

    expect(user.role).toBe("admin");
  });

  test("bookmark() is null before the first query, then a value the next connect() can start from", async () => {
    const first = connect(binding, { session: "first-unconstrained" });
    expect(first.bookmark()).toBeNull();

    await first.model(User).createOrThrow({ id: 1, email: "a@example.com" });
    const bookmark = first.bookmark();
    expect(typeof bookmark).toBe("string");

    const next = connect(binding, { session: bookmark! });
    expect((await next.model(User).find(1)).email).toBe("a@example.com");
  });

  test("uniqueness validation after a write checks through the same session", async () => {
    const db = connect(binding, { session: "first-primary" });
    await db.model(User).createOrThrow({ email: "a@example.com" });
    const written = db.bookmark();

    const duplicate = db.model(User).build({ email: "a@example.com" });

    expect(await duplicate.isValid()).toBe(false);
    expect(duplicate.errors.get("email")).toEqual(["has already been taken"]);
    expect(db.bookmark()).not.toBeNull();
    expect(written).not.toBeNull();
  });

  test("record reads go through the session: uniqueness checks, association reads and preloads", async () => {
    const seed = connect(binding);
    await seed.model(User).insert({ id: 1, email: "a@example.com" });
    await seed.model(Post).insert({ userId: 1, title: "Hello" });

    // Each check starts a fresh session, so its bookmark shows whether that read used it.
    const validating = connect(binding, { session: "first-primary" });
    const user = validating.model(User).build({ email: "a@example.com" });
    expect(await user.isValid()).toBe(false);
    expect(validating.bookmark()).not.toBeNull();

    const reading = connect(binding, { session: "first-primary" });
    const post = reading.model(Post).build({ userId: 1, title: "Unsaved" });
    expect((await post.author())?.email).toBe("a@example.com");
    expect(reading.bookmark()).not.toBeNull();

    const loading = connect(binding, { session: "first-primary" });
    const [loaded] = await loading.model(User).includes("posts").toArray();
    expect(loaded?.loaded("posts")).toHaveLength(1);
    expect(loading.bookmark()).not.toBeNull();
  });

  test("statements and batches go through the session too", async () => {
    const running = connect(binding, { session: "first-primary" });
    await running.model(User).insert({ id: 1, email: "a@example.com" });
    expect(running.bookmark()).not.toBeNull();

    const batching = connect(binding, { session: "first-primary" });
    await batching.batch([batching.model(User).where({ id: 1 }).toUpdateAll({ role: "admin" })]);
    expect(batching.bookmark()).not.toBeNull();
  });

  test("bookmark() on a Database opened without a session throws NoSession", () => {
    expect(() => connect(binding).bookmark()).toThrow(NoSession);
  });
});
