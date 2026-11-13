import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  belongsTo,
  hasMany,
  hasOne,
  InvalidModel,
  Model,
  RecordInvalid,
} from "../../packages/active-record/src/index.ts";
import type { QueryEvent } from "../../packages/active-record/src/executor.ts";
import { openHarness, type Harness } from "../support/harness.ts";

class User extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
}) {
  static table = "users";

  posts = hasMany(Post, { foreignKey: "userId" });
  drafts = hasMany(Post, { foreignKey: "userId", scope: (q) => q.where({ title: "Draft" }) });
  profile = hasOne(Profile, { foreignKey: "userId" });
}

class Profile extends Model.define({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  bio: "string",
}) {
  static table = "profiles";

  user = belongsTo(User, { foreignKey: "userId" });
}

class Post extends Model.define({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
}) {
  static table = "posts";

  author = belongsTo(User, { foreignKey: "userId" });
}

/** Comments on post 99 unless told otherwise, a post that doesn't exist. */
class Reply extends Model.define({
  id: { type: "integer", null: false },
  postId: { type: "integer", default: () => 99 },
  body: "string",
}) {
  static table = "comments";

  post = belongsTo(Post, { foreignKey: "postId" });
}

class Note extends Model.define({
  id: { type: "integer", null: false },
  postId: "integer",
  body: "string",
}) {
  static table = "comments";

  post = belongsTo(Post, { foreignKey: "postId", optional: true });
}

class Comment extends Model.define({
  id: { type: "integer", null: false },
  postId: "integer",
  body: "string",
}) {
  static table = "comments";

  post = belongsTo(Post, { foreignKey: "postId" });
}

describe("a belongsTo requires its record", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.reset("comments", "posts", "profiles", "users");
    await harness.exec("INSERT INTO users (id, email) VALUES (1, 'a@example.com')");
    await harness.exec("INSERT INTO posts (id, user_id, title) VALUES (10, 1, 'First')");
  });

  test("a null key fails validation with must exist, and nothing is written", async () => {
    const queries: QueryEvent[] = [];
    const db = harness.connect({ onQuery: (event) => queries.push(event) });
    const comment = db.model(Comment).build({ id: 1, body: "orphan" });

    expect(await comment.save()).toBe(false);
    expect(comment.errors.get("post")).toEqual(["must exist"]);
    expect(comment.errors.fullMessages()).toEqual(["Post must exist"]);
    expect(queries).toHaveLength(0);
    expect(await db.model(Comment).count()).toBe(0);
  });

  test("a record built through a hasMany points back at its new owner, with no query", async () => {
    const queries: QueryEvent[] = [];
    const db = harness.connect({ onQuery: (event) => queries.push(event) });
    const user = db.model(User).build({ id: 2, email: "b@example.com" });

    const post = user.posts().build({ id: 20, title: "Hello" });

    expect(await post.author()).toBe(user);
    expect(queries).toHaveLength(0);
  });

  test("a record built through a hasOne points back at its new owner, with no query", async () => {
    const queries: QueryEvent[] = [];
    const db = harness.connect({ onQuery: (event) => queries.push(event) });
    const user = db.model(User).build({ id: 2, email: "b@example.com" });

    const profile = user.profile.build({ id: 1, bio: "Hi" });

    expect(await profile.user()).toBe(user);
    expect(queries).toHaveLength(0);
  });

  test("a new owner saves with the records built through it", async () => {
    const db = harness.connect();
    const user = db.model(User).build({ id: 2, email: "b@example.com" });
    const post = user.posts().build({ id: 20, title: "Hello" });

    expect(await user.save()).toBe(true);
    expect(post.isPersisted()).toBe(true);
    expect(post.userId).toBe(2);
  });

  test("a record created through a hasMany points back at its owner, with no query to check it", async () => {
    const queries: QueryEvent[] = [];
    const db = harness.connect({ onQuery: (event) => queries.push(event) });
    const user = await db.model(User).find(1);
    queries.length = 0;

    const post = await user.posts().create({ id: 20, title: "Hello" });

    expect(await post.author()).toBe(user);
    expect(queries).toHaveLength(1);
  });

  test("a record built through a hasMany with another key doesn't point back at the owner", async () => {
    const user = await harness.connect().model(User).find(1);

    const post = user.posts().build({ id: 20, userId: 99, title: "Elsewhere" });

    expect(await post.isValid()).toBe(false);
    expect(post.errors.get("author")).toEqual(["must exist"]);
  });

  test("a record given a null key through a saved owner doesn't point back, so it fails", async () => {
    const user = await harness.connect().model(User).find(1);

    const post = await user.posts().create({ id: 20, title: "Keyless", userId: null as never });

    expect(post.isPersisted()).toBe(false);
    expect(post.errors.get("author")).toEqual(["must exist"]);
  });

  test("a record built through a scoped association doesn't point back, so its owner is read", async () => {
    const queries: QueryEvent[] = [];
    const db = harness.connect({ onQuery: (event) => queries.push(event) });
    const user = await db.model(User).find(1);
    queries.length = 0;

    const draft = user.drafts().build({ id: 20 });

    expect((await draft.author())?.id).toBe(1);
    expect(queries).toHaveLength(1);
  });

  test("a key that points at no row fails the same way, after one read", async () => {
    const queries: QueryEvent[] = [];
    const db = harness.connect({ onQuery: (event) => queries.push(event) });
    const comment = db.model(Comment).build({ id: 1, postId: 99, body: "dangling" });

    expect(await comment.save()).toBe(false);
    expect(comment.errors.get("post")).toEqual(["must exist"]);
    expect(queries).toHaveLength(1);
  });

  test("a record that exists passes, and stays loaded", async () => {
    const queries: QueryEvent[] = [];
    const db = harness.connect({ onQuery: (event) => queries.push(event) });
    const comment = db.model(Comment).build({ id: 1, postId: 10, body: "on topic" });

    expect(await comment.save()).toBe(true);
    queries.length = 0;
    expect((await comment.post())?.title).toBe("First");
    expect(queries).toHaveLength(0);
  });

  test("a saved record set through the association passes without a query", async () => {
    const queries: QueryEvent[] = [];
    const db = harness.connect({ onQuery: (event) => queries.push(event) });
    const post = await db.model(Post).find(10);
    const comment = db.model(Comment).build({ id: 1, body: "saved" });
    comment.post.set(post);
    queries.length = 0;

    expect(await comment.isValid()).toBe(true);
    expect(queries).toHaveLength(0);
  });

  test("a new record built through the association passes without a query", async () => {
    const queries: QueryEvent[] = [];
    const db = harness.connect({ onQuery: (event) => queries.push(event) });
    const user = await db.model(User).find(1);
    const comment = db.model(Comment).build({ id: 2, body: "new" });
    comment.post.build({ id: 11, title: "Second" }).author.set(user);
    queries.length = 0;

    expect(await comment.isValid()).toBe(true);
    expect(queries).toHaveLength(0);
  });

  test("a saved record whose key hasn't changed isn't checked again", async () => {
    await harness.exec("INSERT INTO comments (id, post_id, body) VALUES (1, 10, 'old')");
    const queries: QueryEvent[] = [];
    const db = harness.connect({ onQuery: (event) => queries.push(event) });
    const comment = await db.model(Comment).find(1);
    queries.length = 0;

    comment.body = "edited";

    expect(await comment.save()).toBe(true);
    expect(queries).toHaveLength(1); // the UPDATE alone
  });

  test("a new record whose key holds its declared default isn't checked", async () => {
    const queries: QueryEvent[] = [];
    const db = harness.connect({ onQuery: (event) => queries.push(event) });
    const reply = db.model(Reply).build({ id: 1, body: "On topic" });

    expect(await reply.isValid()).toBe(true);
    expect(queries).toHaveLength(0);
  });

  test("a saved record whose key changed is checked again", async () => {
    await harness.exec("INSERT INTO comments (id, post_id, body) VALUES (1, 10, 'old')");
    const comment = await harness.connect().model(Comment).find(1);

    comment.postId = 11;

    expect(await comment.save()).toBe(false);
    expect(comment.errors.get("post")).toEqual(["must exist"]);
  });

  test("in a batch, a missing record stops it: RecordInvalid, and nothing is written", async () => {
    const db = harness.connect();
    const valid = db.model(Comment).build({ id: 1, postId: 10, body: "on topic" });
    const orphan = db.model(Comment).build({ id: 2, body: "orphan" });

    const error: unknown = await db
      .batch((b) => [b.save(valid), b.save(orphan)])
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(RecordInvalid);
    expect(orphan.errors.get("post")).toEqual(["must exist"]);
    expect(await db.model(Comment).count()).toBe(0);
  });

  test("optional: true saves a null key", async () => {
    const note = harness.connect().model(Note).build({ id: 1, body: "loose" });

    expect(await note.save()).toBe(true);
  });

  test("only a belongsTo can be optional: on a hasMany it's an InvalidModel", () => {
    class Owner extends Model.define({ id: { type: "integer", null: false } }) {
      static table = "users";

      posts = hasMany(Post, { foreignKey: "userId", optional: true } as never);
    }

    expect(() => harness.connect().model(Owner).build({ id: 1 })).toThrow(
      new InvalidModel('Owner association "posts": only a belongsTo can be optional'),
    );
  });

  test("it runs before the declared validations", async () => {
    class Remark extends Comment {
      static {
        this.validates("body", { presence: true });
      }
    }
    const remark = harness.connect().model(Remark).build({ id: 1, body: "" });

    expect(await remark.save()).toBe(false);
    expect(remark.errors.fullMessages()).toEqual(["Post must exist", "Body can't be blank"]);
  });

  test("its message is the app's when it gives one", async () => {
    class Reply extends Comment {
      static {
        this.errorMessages({ required: "is missing" });
      }
    }
    const reply = harness.connect().model(Reply).build({ id: 1, body: "orphan" });

    expect(await reply.save()).toBe(false);
    expect(reply.errors.fullMessages()).toEqual(["Post is missing"]);
  });
});
