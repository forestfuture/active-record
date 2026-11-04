import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  hasMany,
  Model,
  RecordInvalid,
  RecordNotSaved,
  RecordNotUnique,
} from "../../packages/active-record/src/index.ts";
import type { QueryEvent } from "../../packages/active-record/src/executor.ts";
import { openHarness, type Harness } from "../support/harness.ts";

const log: string[] = [];

class User extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
}) {
  static table = "users";

  posts = hasMany(Post, { foreignKey: "userId" });

  static {
    this.beforeSave((user) => void log.push(`before save ${user.email}`));
    this.afterSave((user) => void log.push(`after save ${user.email}`));
  }
}

class Post extends Model.define({
  id: { type: "integer", null: false },
  userId: "integer",
  title: { type: "string", null: false },
}) {
  static table = "posts";

  comments = hasMany(Comment, { foreignKey: "postId" });

  static {
    this.validates("title", { presence: true });
    this.beforeSave((post) => void log.push(`before save ${post.title}`));
    this.afterSave((post) => void log.push(`after save ${post.title}`));
  }
}

class Comment extends Model.define({
  id: { type: "integer", null: false },
  postId: "integer",
  body: "string",
}) {
  static table = "comments";

  static {
    this.beforeValidation((comment) => void log.push(`validating ${comment.body}`));
    this.afterValidation((comment) => void log.push(`validated ${comment.body}`));
  }
}

let counter = 0;

class ApiKey extends Model.define({
  id: { type: "string", null: false, default: () => `key-${++counter}` },
  label: { type: "string", null: false },
}) {
  static table = "api_keys";

  accounts = hasMany(Account, { foreignKey: "externalAccountId" });
}

class Account extends Model.define({
  id: { type: "integer", null: false },
  externalAccountId: "string",
}) {
  static table = "accounts";
}

describe("autosave: records built through a hasMany are saved with their owner", () => {
  let harness: Harness;
  const events: QueryEvent[] = [];
  const db = () => harness.connect({ onQuery: (event) => events.push(event) });

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    log.length = 0;
    await harness.reset("comments", "posts", "users", "accounts", "api_keys");
    events.length = 0;
  });

  test("saving a new owner inserts its built records with the owner's new key", async () => {
    const user = db().model(User).build({ email: "a@example.com" });
    const post = user.posts().build({ title: "Hello" });
    expect(post.userId).toBeNull();

    expect(await user.save()).toBe(true);

    expect(post.isPersisted()).toBe(true);
    expect(post.userId).toBe(user.id);
    expect(await db().model(Post).pluck("userId")).toEqual([user.id]);
  });

  test("an unsaved owner's association reads its built records, without a query", async () => {
    const user = db().model(User).build({ email: "a@example.com" });
    const first = user.posts().build({ title: "One" });
    user.posts().where({ title: "Two" }).build();

    expect(await user.posts().toArray()).toHaveLength(2);
    expect(await user.posts().first()).toBe(first);
    expect(await user.posts().pluck("title")).toEqual(["One", "Two"]);
    expect(events).toHaveLength(0);
  });

  test("a saved owner's loaded collection includes a built record, and saving the owner saves it", async () => {
    const user = await db().model(User).createOrThrow({ email: "a@example.com" });
    await user.posts().toArray();
    const post = user.posts().build({ title: "Later" });
    events.length = 0;

    expect(await user.posts().toArray()).toEqual([post]);
    await user.saveOrThrow();

    expect(post.isPersisted()).toBe(true);
    expect(post.userId).toBe(user.id);
  });

  test("an invalid built record makes the owner invalid, and nothing is written", async () => {
    const user = db().model(User).build({ email: "a@example.com" });
    const post = user.posts().build({ title: "" });

    expect(await user.save()).toBe(false);

    expect(user.errors.fullMessages()).toEqual(["Posts is invalid"]);
    expect(post.errors.get("title")).toEqual(["can't be blank"]);
    expect(user.isNewRecord()).toBe(true);
    await expect(user.saveOrThrow()).rejects.toThrow(RecordInvalid);
    expect(await db().model(User).count()).toBe(0);
  });

  test("callbacks: the owner's before, the records' before, the writes, the owner's after, the records' after", async () => {
    const user = db().model(User).build({ email: "a@example.com" });
    user.posts().build({ title: "Hello" });

    await user.saveOrThrow();

    expect(log).toEqual([
      "before save a@example.com",
      "before save Hello",
      "after save a@example.com",
      "after save Hello",
    ]);
  });

  test("with a key generated in code, the owner and its records are written in one batch, atomically", async () => {
    await harness.exec("INSERT INTO accounts (id) VALUES (1)");
    const key = db().model(ApiKey).build({ label: "deploy" });
    key.accounts().build({ id: 2 });
    key.accounts().build({ id: 1 });
    events.length = 0;

    await expect(key.save()).rejects.toThrow(RecordNotUnique);

    expect(events).toHaveLength(3);
    expect(key.isNewRecord()).toBe(true);
    expect(await db().model(ApiKey).count()).toBe(0);
    expect(await db().model(Account).pluck("id")).toEqual([1]);
  });

  test("…and the records get the owner's key before anything is written", async () => {
    const key = db().model(ApiKey).build({ label: "deploy" });
    const account = key.accounts().build({ id: 1 });

    await key.saveOrThrow();

    expect(account.externalAccountId).toBe(key.id);
    expect(await key.accounts().pluck("id")).toEqual([1]);
  });

  test("with a key the database generates, the owner is written first: a record that then fails leaves the owner saved", async () => {
    await harness.exec("INSERT INTO users (id, email) VALUES (1, 'x@example.com')");
    await harness.exec("INSERT INTO posts (id, user_id, title) VALUES (10, 1, 'Taken')");
    const user = db().model(User).build({ email: "a@example.com" });
    const post = user.posts().build({ id: 10, title: "Clash" });

    await expect(user.save()).rejects.toThrow(RecordNotUnique);

    expect(user.isPersisted()).toBe(true);
    expect(post.isNewRecord()).toBe(true);
  });

  test("an owner with nothing to change still saves its built records", async () => {
    const user = await db().model(User).createOrThrow({ email: "a@example.com" });
    const post = user.posts().build({ title: "Hello" });

    await user.saveOrThrow();

    expect(post.isPersisted()).toBe(true);
  });

  test("a built record saved on its own isn't saved again, and create doesn't autosave", async () => {
    const user = await db().model(User).createOrThrow({ email: "a@example.com" });
    const post = user.posts().build({ title: "Hello" });
    await post.saveOrThrow();
    await user.posts().createOrThrow({ title: "Created" });
    events.length = 0;

    await user.saveOrThrow();

    expect(events).toHaveLength(0);
    expect(await db().model(Post).count()).toBe(2);
  });

  test("in a batch, an owner autosaves when its key is known, and refuses when the database would generate it", async () => {
    const database = db();
    const key = database.model(ApiKey).build({ label: "deploy" });
    key.accounts().build({ id: 1 });
    const user = database.model(User).build({ email: "a@example.com" });
    user.posts().build({ title: "Hello" });

    await database.batch([key.toSave()]);
    expect(await database.model(Account).count()).toBe(1);

    await expect(database.batch([user.toSave()])).rejects.toThrow(RecordNotSaved);
    expect(await database.model(User).count()).toBe(0);
  });

  test("autosave reaches every level: a built record's own built records are saved too", async () => {
    const user = db().model(User).build({ email: "a@example.com" });
    const post = user.posts().build({ title: "Hello" });
    const comment = post.comments().build({ body: "First!" });

    await user.saveOrThrow();

    expect(comment.isPersisted()).toBe(true);
    expect(comment.postId).toBe(post.id);
    expect(post.userId).toBe(user.id);
  });

  test("built records are validated one after another, in the order they were built", async () => {
    const user = await db().model(User).createOrThrow({ email: "a@example.com" });
    const post = await user.posts().createOrThrow({ title: "Hello" });
    post.comments().build({ body: "one" });
    post.comments().build({ body: "two" });
    log.length = 0;

    await post.saveOrThrow();

    expect(log.filter((line) => line.startsWith("validat"))).toEqual([
      "validating one",
      "validated one",
      "validating two",
      "validated two",
    ]);
  });

  test("in a batch, a record already saved through its owner's autosave is written once", async () => {
    const database = db();
    const key = database.model(ApiKey).build({ label: "deploy" });
    const account = key.accounts().build({ id: 1 });
    const other = database.model(Account).build({ id: 2 });
    events.length = 0;

    await database.batch([key.toSave(), account.toSave(), other.toSave(), other.toSave()]);

    expect(events).toHaveLength(3);
    expect(await database.model(Account).order({ id: "asc" }).pluck("id")).toEqual([1, 2]);
  });

  test("reload() discards built records, as does reloadAssociation()", async () => {
    const user = await db().model(User).createOrThrow({ email: "a@example.com" });
    user.posts().build({ title: "Dropped by reload" });
    await user.reload();
    await user.saveOrThrow();
    user.posts().build({ title: "Dropped by reloadAssociation" });
    await user.reloadAssociation("posts");
    await user.saveOrThrow();

    expect(await db().model(Post).count()).toBe(0);
  });

  test("when a record fails after its new owner was written, the owner's after-callbacks still run", async () => {
    await harness.exec("INSERT INTO users (id, email) VALUES (1, 'x@example.com')");
    await harness.exec("INSERT INTO posts (id, user_id, title) VALUES (10, 1, 'Taken')");
    const user = db().model(User).build({ email: "a@example.com" });
    user.posts().build({ id: 10, title: "Clash" });

    await expect(user.save()).rejects.toThrow(RecordNotUnique);

    expect(log).toContain("after save a@example.com");
    expect(log).not.toContain("after save Clash");
  });

  test("a saved owner's loaded association shows its built records after the stored ones, however it's loaded", async () => {
    const user = await db().model(User).createOrThrow({ email: "a@example.com" });
    await harness.exec(`INSERT INTO posts (id, user_id, title) VALUES (10, ${user.id}, 'Stored')`);
    user.posts().build({ title: "Built" });

    const titles = async () => (await user.posts().toArray()).map((post) => post.title);

    expect(await titles()).toEqual(["Stored", "Built"]);
    await user.posts().updateAll({ title: "Changed" });
    expect(await titles()).toEqual(["Changed", "Built"]);
  });
});
