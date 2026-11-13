import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  belongsTo,
  hasMany,
  hasOne,
  Model,
  RecordNotSaved,
} from "../../packages/active-record/src/index.ts";
import type { QueryEvent } from "../../packages/active-record/src/executor.ts";
import { openHarness, type Harness } from "../support/harness.ts";

class User extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
}) {
  static table = "users";

  profile = hasOne(Profile, { foreignKey: "userId" });

  static {
    this.validates("email", { presence: true });
  }
}

const log: string[] = [];

class Post extends Model.define({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
}) {
  static table = "posts";

  author = belongsTo(User, { foreignKey: "userId" });
  comments = hasMany(Comment, { foreignKey: "postId" });

  static {
    this.beforeSave((post) => void log.push(`post sees user ${String(post.userId)}`));
  }
}

class Comment extends Model.define({
  id: { type: "integer", null: false },
  postId: "integer",
  body: "string",
}) {
  static table = "comments";
}

class Profile extends Model.define({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  bio: "string",
}) {
  static table = "profiles";

  static {
    this.validates("bio", { presence: true });
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

  apiKey = belongsTo(ApiKey, { foreignKey: "externalAccountId" });

  static {
    this.beforeSave(
      (account) => void log.push(`account sees key ${String(account.externalAccountId)}`),
    );
  }
}

describe("building and setting hasOne and belongsTo", () => {
  let harness: Harness;
  const events: QueryEvent[] = [];
  const db = () => harness.connect({ onQuery: (event) => events.push(event) });

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    log.length = 0;
    await harness.reset("comments", "posts", "profiles", "users", "accounts", "api_keys");
    await harness.exec(
      "INSERT INTO users (id, email) VALUES (1, 'a@example.com'), (2, 'b@example.com')",
    );
    await harness.exec("INSERT INTO posts (id, user_id, title) VALUES (10, 1, 'Hello')");
    events.length = 0;
  });

  describe("belongsTo", () => {
    test("set() points the record at another, which then reads without a query, and save writes it", async () => {
      const database = db();
      const post = await database.model(Post).find(10);
      const other = await database.model(User).find(2);
      events.length = 0;

      post.author.set(other);

      expect(post.userId).toBe(2);
      expect(await post.author()).toBe(other);
      expect(events).toHaveLength(0);
      await post.saveOrThrow();
      expect((await database.model(Post).find(10)).userId).toBe(2);
    });

    test("set(null) clears the key and the association", async () => {
      const post = db().model(Post).build({ title: "Draft", userId: 1 });

      post.author.set(null);

      expect(post.userId).toBeNull();
      expect(await post.author()).toBeNull();
      expect(post.isLoaded("author")).toBe(true);
    });

    test("set() takes only a record of the association's Model", () => {
      const post = db().model(Post).build({ title: "Draft" });

      expect(() => post.author.set(post as never)).toThrow(TypeError);
    });

    test("a built author is validated with the post, saved first, and the post points at it", async () => {
      const post = db().model(Post).build({ title: "Hello again" });
      const author = post.author.build({ email: "new@example.com" });

      await post.saveOrThrow();

      expect(author.isPersisted()).toBe(true);
      expect(post.userId).toBe(author.id);
      expect(await post.author()).toBe(author);
    });

    test("an invalid built author makes the post invalid, and nothing is written", async () => {
      const post = db().model(Post).build({ title: "Hello again" });
      post.author.build({ email: "" });

      expect(await post.save()).toBe(false);

      expect(post.errors.fullMessages()).toEqual(["Author is invalid"]);
      expect(await db().model(User).count()).toBe(2);
    });

    test("with a key generated in code, the new record and the owner are one atomic batch", async () => {
      const account = db().model(Account).build({ id: 1 });
      const key = account.apiKey.build({ label: "deploy" });
      events.length = 0;

      await account.saveOrThrow();

      expect(events).toHaveLength(2);
      expect(account.externalAccountId).toBe(key.id);
    });

    test("create() saves the new record at once and points the owner at it, without saving the owner", async () => {
      const post = await db().model(Post).find(10);

      const author = await post.author.createOrThrow({ email: "c@example.com" });

      expect(author.isPersisted()).toBe(true);
      expect(post.userId).toBe(author.id);
      expect(post.changed()).toEqual(["userId"]);
    });

    test("a new record saved on its own before the owner still gets linked when the owner saves", async () => {
      const post = db().model(Post).build({ title: "Hello again" });
      const author = post.author.build({ email: "new@example.com" });

      await author.saveOrThrow();
      await post.saveOrThrow();

      expect(post.userId).toBe(author.id);
    });

    test("set() replaces an earlier set() before the save, and reload() forgets a built record", async () => {
      const database = db();
      const post = await database.model(Post).find(10);
      post.author.build({ email: "dropped@example.com" });
      post.author.set(await database.model(User).find(2));
      await post.saveOrThrow();

      post.author.build({ email: "also-dropped@example.com" });
      await post.reload();
      await post.saveOrThrow();

      expect(post.userId).toBe(2);
      expect(await database.model(User).count()).toBe(2);
    });

    test("with a key generated in code, the owner's before-callbacks already see its foreign key", async () => {
      const account = db().model(Account).build({ id: 1 });
      const key = account.apiKey.build({ label: "deploy" });

      await account.saveOrThrow();

      expect(log).toEqual([`account sees key ${key.id}`]);
    });

    test("with a key the database generates, the owner's before-callbacks run before it exists", async () => {
      const post = db().model(Post).build({ title: "Hello again" });
      post.author.build({ email: "new@example.com" });

      await post.saveOrThrow();

      expect(log).toEqual(["post sees user null"]);
    });

    test("a new author, the post and the post's new comments save together, in order", async () => {
      const post = db().model(Post).build({ title: "Hello again" });
      const author = post.author.build({ email: "new@example.com" });
      const comment = post.comments().build({ body: "First!" });

      await post.saveOrThrow();

      expect([post.userId, comment.postId]).toEqual([author.id, post.id]);
    });
  });

  describe("hasOne", () => {
    test("an unsaved owner reads its built record without a query, before and after saving", async () => {
      const user = db().model(User).build({ email: "new@example.com" });
      const profile = user.profile.build({ bio: "Hi" });
      events.length = 0;

      expect(await user.profile()).toBe(profile);
      await user.saveOrThrow();
      events.length = 0;
      expect(await user.profile()).toBe(profile);
      expect(events).toHaveLength(0);
    });

    test("saving a new owner leaves a record built through it, then saved on its own, as it is", async () => {
      const user = db().model(User).build({ email: "new@example.com" });
      const elsewhere = user.profile.build({ bio: "Elsewhere" });
      elsewhere.userId = 1;
      await elsewhere.saveOrThrow();
      user.profile.build({ bio: "Mine" });

      await user.saveOrThrow();

      expect(elsewhere.userId).toBe(1);
      expect(await db().model(Profile).where({ userId: 1 }).pluck("bio")).toEqual(["Elsewhere"]);
    });

    test("a create() that fails is kept, so saving the owner tries it again, as in Rails", async () => {
      const user = await db().model(User).find(1);
      const profile = await user.profile.create({ bio: "" });
      expect(profile.isPersisted()).toBe(false);

      profile.bio = "Fixed";
      await user.saveOrThrow();

      expect(profile.isPersisted()).toBe(true);
    });

    test("build() makes a record pointing at a saved owner, which reads it without a query and saves it", async () => {
      const database = db();
      const user = await database.model(User).find(2);
      events.length = 0;

      const profile = user.profile.build({ bio: "Hi" });

      expect(profile.userId).toBe(2);
      expect(await user.profile()).toBe(profile);
      expect(events).toHaveLength(0);
      await user.saveOrThrow();
      expect(profile.isPersisted()).toBe(true);
    });

    test("an unsaved owner's built record is saved with it, with its new key", async () => {
      const user = db().model(User).build({ email: "new@example.com" });
      const profile = user.profile.build({ bio: "Hi" });

      await user.saveOrThrow();

      expect(profile.userId).toBe(user.id);
      expect((await db().model(Profile).findByOrThrow({ userId: user.id })).bio).toBe("Hi");
    });

    test("create() saves at once, and throws RecordNotSaved for an unsaved owner", async () => {
      const user = await db().model(User).find(1);
      const created = await user.profile.createOrThrow({ bio: "Hi" });
      const unsaved = db().model(User).build({ email: "new@example.com" });

      expect(created.isPersisted()).toBe(true);
      expect(await user.profile()).toBe(created);
      await expect(unsaved.profile.create({ bio: "Hi" })).rejects.toThrow(RecordNotSaved);
    });
  });

  test("in a batch, a new belongsTo record is saved when its key is known, and refused when the database generates it", async () => {
    const database = db();
    const account = database.model(Account).build({ id: 1 });
    account.apiKey.build({ label: "deploy" });
    const post = database.model(Post).build({ title: "Hello again" });
    post.author.build({ email: "new@example.com" });

    await database.batch((b) => [b.save(account)]);
    expect(await database.model(ApiKey).count()).toBe(1);

    await expect(database.batch((b) => [b.save(post)])).rejects.toThrow(RecordNotSaved);
  });
});
