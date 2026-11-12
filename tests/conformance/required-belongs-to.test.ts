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

  test("a record built through its owner points back at it, so a new owner saves with it", async () => {
    const queries: QueryEvent[] = [];
    const db = harness.connect({ onQuery: (event) => queries.push(event) });
    const user = db.model(User).build({ id: 2, email: "b@example.com" });
    const post = user.posts().build({ id: 20, title: "Hello" });
    const profile = user.profile.build({ id: 1, bio: "Hi" });

    expect(await post.author()).toBe(user);
    expect(await profile.user()).toBe(user);
    expect(queries).toHaveLength(0);
    expect(await user.save()).toBe(true);
    expect(await db.model(Post).where({ userId: 2 }).pluck("title")).toEqual(["Hello"]);
  });

  test("a key that points at no row fails the same way, after one read", async () => {
    const queries: QueryEvent[] = [];
    const db = harness.connect({ onQuery: (event) => queries.push(event) });
    const comment = db.model(Comment).build({ id: 1, postId: 99, body: "dangling" });

    expect(await comment.save()).toBe(false);
    expect(comment.errors.get("post")).toEqual(["must exist"]);
    expect(queries.map((event) => event.sql.split(" ")[0])).toEqual(["SELECT"]);
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

  test("a record set through the association passes without a query, saved or new", async () => {
    const queries: QueryEvent[] = [];
    const db = harness.connect({ onQuery: (event) => queries.push(event) });
    const post = await db.model(Post).find(10);
    const user = await db.model(User).find(1);
    const onSaved = db.model(Comment).build({ id: 1, body: "saved" });
    const onNew = db.model(Comment).build({ id: 2, body: "new" });
    onSaved.post.set(post);
    onNew.post.build({ id: 11, title: "Second" }).author.set(user);
    queries.length = 0;

    expect(await onSaved.isValid()).toBe(true);
    expect(await onNew.isValid()).toBe(true);
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
    expect(queries.map((event) => event.sql.split(" ")[0])).toEqual(["UPDATE"]);

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
