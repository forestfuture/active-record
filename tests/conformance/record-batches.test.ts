import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  abort,
  hasMany,
  IncompatibleRelation,
  Model,
  RecordInvalid,
  RecordNotDestroyed,
  RecordNotSaved,
  RecordNotUnique,
} from "../../packages/active-record/src/index.ts";
import type { QueryEvent } from "../../packages/active-record/src/executor.ts";
import { openHarness, type Harness } from "../support/harness.ts";

const log: string[] = [];

class User extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  role: "string",
}) {
  static table = "users";

  posts = hasMany(Post, { foreignKey: "userId", dependent: "deleteAll" });

  static {
    this.validates("email", { presence: true });
    this.beforeSave((user) => {
      if (user.role === "blocked") throw abort("blocked users can't be saved");
      log.push(`before save ${user.email}`);
    });
    this.afterSave((user) => void log.push(`after save ${user.email}`));
    this.beforeDestroy((user) => {
      if (user.role === "keep") throw abort("this user is kept");
    });
  }
}

class Post extends Model.define({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
}) {
  static table = "posts";

  static {
    this.beforeSave((post) => void log.push(`before save ${post.title}`));
    this.afterSave((post) => void log.push(`after save ${post.title}`));
    this.afterDestroy((post) => void log.push(`after destroy ${post.title}`));
  }
}

let counter = 0;

class ApiKey extends Model.define({
  id: { type: "string", null: false, default: () => `key-${++counter}` },
  label: { type: "string", null: false },
}) {
  static table = "api_keys";
}

class Account extends Model.define({
  id: { type: "integer", null: false },
  externalAccountId: "string",
}) {
  static table = "accounts";
}

describe("saving and destroying records in a batch", () => {
  let harness: Harness;
  const events: QueryEvent[] = [];
  const db = () => harness.connect({ onQuery: (event) => events.push(event) });

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    log.length = 0;
    await harness.reset("posts", "users", "api_keys", "accounts");
    await harness.exec("INSERT INTO users (id, email) VALUES (1, 'a@example.com')");
    await harness.exec(
      "INSERT INTO posts (id, user_id, title) VALUES (10, 1, 'First'), (11, 1, 'Second')",
    );
    events.length = 0;
  });

  test("records and statements are written in one batch, then each record takes its saved state", async () => {
    const database = db();
    const user = database.model(User).build({ email: "b@example.com" });
    const post = await database.model(Post).find(10);
    const other = await database.model(Post).find(11);
    post.title = "Renamed";
    events.length = 0;

    const [saved, updated, destroyed, meta] = await database.batch((b) => [
      b.save(user),
      b.save(post),
      b.destroy(other),
      b.updateAll(database.model(User).where({ id: 1 }), { role: "admin" }),
    ]);

    expect(saved).toBe(user);
    expect(updated).toBe(post);
    expect(destroyed).toBe(other);
    expect(meta).toEqual({ rowsAffected: 1, rows: [] });
    expect(events).toHaveLength(4);
    expect(user.isPersisted()).toBe(true);
    expect(typeof user.id).toBe("number");
    expect(post.changed()).toEqual([]);
    expect(other.isDestroyed()).toBe(true);
    expect(await database.model(Post).pluck("title")).toEqual(["Renamed"]);
  });

  test("b.save and b.destroy write records in the batch, resolving to each record", async () => {
    const database = db();
    const user = database.model(User).build({ email: "b@example.com" });
    const post = await database.model(Post).find(10);

    const [saved, destroyed] = await database.batch((b) => [b.save(user), b.destroy(post)]);

    expect(saved).toBe(user);
    expect(destroyed).toBe(post);
    expect(user.isPersisted()).toBe(true);
    expect(post.isDestroyed()).toBe(true);
    expect(log).toEqual([
      "before save b@example.com",
      "after save b@example.com",
      "after destroy First",
    ]);
    expect(await database.model(Post).pluck("id")).toEqual([11]);
  });

  test("every before-callback runs before anything is written, and the after-callbacks after, in order", async () => {
    const database = db();
    const user = database.model(User).build({ email: "b@example.com" });
    const post = database.model(Post).build({ userId: 1, title: "Hello" });

    await database.batch((b) => [b.save(user), b.save(post)]);

    expect(log).toEqual([
      "before save b@example.com",
      "before save Hello",
      "after save b@example.com",
      "after save Hello",
    ]);
  });

  test("an invalid record stops the batch: RecordInvalid, nothing written, later records untouched", async () => {
    const database = db();
    const valid = database.model(User).build({ email: "b@example.com" });
    const invalid = database.model(User).build({ email: "" });
    const post = database.model(Post).build({ userId: 1, title: "Hello" });

    const error: unknown = await database
      .batch((b) => [b.save(valid), b.save(invalid), b.save(post)])
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RecordInvalid);
    expect((error as RecordInvalid).record).toBe(invalid);
    expect(invalid.errors.get("email")).toEqual(["can't be blank"]);
    expect(log).toEqual(["before save b@example.com"]);
    expect(valid.isNewRecord()).toBe(true);
    expect(await database.model(User).count()).toBe(1);
  });

  test("an abort stops the batch: RecordNotSaved or RecordNotDestroyed", async () => {
    const database = db();
    const blocked = database.model(User).build({ email: "b@example.com", role: "blocked" });
    const kept = await database.model(User).find(1);
    kept.role = "keep";

    await expect(database.batch((b) => [b.save(blocked)])).rejects.toThrow(RecordNotSaved);
    await expect(database.batch((b) => [b.destroy(kept)])).rejects.toThrow(RecordNotDestroyed);
    expect(await database.model(User).count()).toBe(1);
  });

  test("when the database refuses the batch, nothing is written and records keep their unsaved state", async () => {
    const database = db();
    const user = database.model(User).build({ email: "b@example.com" });
    const post = await database.model(Post).find(10);
    post.title = "Renamed";

    await expect(
      database.batch((b) => [
        b.save(user),
        b.save(post),
        b.insert(User, { id: 2, email: "a@example.com" }),
      ]),
    ).rejects.toThrow(RecordNotUnique);

    expect(user.isNewRecord()).toBe(true);
    expect(post.changed()).toEqual(["title"]);
    expect(log.filter((line) => line.startsWith("after"))).toEqual([]);
    expect(await database.model(User).count()).toBe(1);
    expect((await database.model(Post).find(10)).title).toBe("First");
  });

  test("keys generated in code link records inside one batch", async () => {
    const database = db();
    const key = database.model(ApiKey).build({ label: "deploy" });
    const account = database.model(Account).build({ externalAccountId: key.id });

    await database.batch((b) => [b.save(key), b.save(account)]);

    const stored = await database.model(Account).findByOrThrow({ externalAccountId: key.id });
    expect(stored.id).toBe(account.id);
  });

  test("a record listed twice is written once", async () => {
    const database = db();
    const post = await database.model(Post).find(11);
    events.length = 0;

    await database.batch((b) => [b.destroy(post), b.destroy(post)]);

    expect(events).toHaveLength(1);
    expect(log).toEqual(["after destroy Second"]);
  });

  test("a destroy statement brings its dependents into the batch", async () => {
    const database = db();
    const user = await database.model(User).find(1);

    await database.batch((b) => [b.destroy(user)]);

    expect(user.isDestroyed()).toBe(true);
    expect(await database.model(Post).count()).toBe(0);
  });

  test("a record from another Database is refused before any callback runs", async () => {
    const user = db().model(User).build({ email: "b@example.com" });

    await expect(db().batch((b) => [b.save(user)])).rejects.toThrow(IncompatibleRelation);
    expect(log).toEqual([]);
  });

  test("a prepared save isn't awaitable, and saves only with its batch", async () => {
    const database = db();
    const user = database.model(User).build({ email: "b@example.com" });

    await database.batch((b) => {
      expect("then" in b.save(user)).toBe(false);
      return [];
    });

    expect(user.isNewRecord()).toBe(true);
  });
});
