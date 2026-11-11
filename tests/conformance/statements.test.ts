import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  batch,
  column,
  hasMany,
  IncompatibleRelation,
  InvalidForeignKey,
  Model,
  NotNullViolation,
  RecordNotSaved,
  RecordNotUnique,
  sql,
  UnknownAttribute,
  withDatabase,
  type Batch,
} from "../../packages/active-record/src/index.ts";
import type { QueryEvent } from "../../packages/active-record/src/executor.ts";
import type { AnyDatabase } from "../../packages/active-record/src/database.ts";
import { openHarness, type Harness } from "../support/harness.ts";
import { holdStatements, reads } from "../support/hold-statements.ts";

const log: string[] = [];

class User extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  role: "string",
  age: "integer",
}) {
  static table = "users";

  posts = hasMany(Post, { foreignKey: "userId" });

  static {
    this.validates("role", { presence: true });
    this.beforeSave(() => void log.push("beforeSave"));
    this.afterCreate(() => void log.push("afterCreate"));
  }
}

class Post extends Model.define({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
  published: { type: "boolean", null: false },
  createdAt: "datetime",
  updatedAt: "datetime",
}) {
  static table = "posts";

  comments = hasMany(Comment, { foreignKey: "postId" });
}

class Comment extends Model.define({
  id: { type: "integer", null: false },
  postId: "integer",
  body: "string",
}) {
  static table = "comments";
}

let counter = 0;

class ApiKey extends Model.define({
  id: { type: "string", null: false, default: () => `key-${++counter}` },
  label: { type: "string", null: false },
  scopes: "json",
}) {
  static table = "api_keys";
}

class Account extends Model.define({
  id: { type: "integer", null: false },
  externalAccountId: "string",
}) {
  static table = "accounts";
}

const past = new Date(Date.UTC(2020, 0, 1));

/** The bodies of some comments, in order. */
const bodies = (comments: readonly { body: string | null }[]) =>
  comments.map((comment) => comment.body);

describe("statements", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    log.length = 0;
    await harness.reset("comments", "posts", "users", "api_keys", "accounts");
  });

  describe("insert", () => {
    test("insert writes the row and resolves to its key, skipping validations and callbacks", async () => {
      const db = harness.connect();

      const result = await db.model(User).insert({ id: 1, email: "a@example.com" });

      expect(result).toEqual({ rowsAffected: 1, rows: [{ id: 1 }] });
      expect(log).toEqual([]);
      const user = await db.model(User).find(1);
      expect(user.email).toBe("a@example.com");
      expect(user.role).toBeNull(); // presence validation skipped
    });

    test("an unknown attribute rejects the immediate forms and the batch preparing it", async () => {
      const users = harness.connect().model(User);

      await expect(users.insert({ nope: 1 } as never)).rejects.toThrow(UnknownAttribute);
      await expect(users.updateAll({ nope: 1 } as never)).rejects.toThrow(UnknownAttribute);
      await expect(batch((b) => [b.insert(users, { nope: 1 } as never)])).rejects.toThrow(
        UnknownAttribute,
      );
      await expect(batch((b) => [b.updateAll(users, { nope: 1 } as never)])).rejects.toThrow(
        UnknownAttribute,
      );
    });

    test("preparing a write doesn't query; attribute values are converted when it's prepared", async () => {
      const events: QueryEvent[] = [];
      const db = harness.connect({ onQuery: (event) => events.push(event) });
      let sentWhilePreparing: number | undefined;

      await db.batch((b) => {
        const write = b.insert(ApiKey, { label: "deploy", scopes: ["read"] });
        sentWhilePreparing = events.length;
        return [write];
      });

      expect(sentWhilePreparing).toBe(0);
      expect(events).toHaveLength(1);
      const key = await db.model(ApiKey).findByOrThrow({ label: "deploy" });
      expect(key.scopes).toEqual(["read"]);
    });

    test("declared defaults fill attributes that weren't given, like app-generated keys", async () => {
      const db = harness.connect();

      await db.model(ApiKey).insert({ label: "deploy" });
      await db.model(ApiKey).insert({ id: "mine", label: "release" });

      expect(await db.model(ApiKey).order({ label: "asc" }).pluck("id")).toEqual([
        `key-${counter}`,
        "mine",
      ]);
    });

    test("createdAt and updatedAt are set to now, unless given", async () => {
      const db = harness.connect();
      await db.model(User).insert({ id: 1, email: "a@example.com" });
      const before = Date.now();

      await db.model(Post).insert({ id: 1, userId: 1, title: "Now", published: false });
      await db
        .model(Post)
        .insert({ id: 2, userId: 1, title: "Then", published: false, createdAt: past });

      const now = await db.model(Post).find(1);
      const then = await db.model(Post).find(2);
      expect(now.createdAt?.getTime()).toBeGreaterThanOrEqual(before);
      expect(now.updatedAt).toEqual(now.createdAt);
      expect(then.createdAt).toEqual(past);
      expect(then.updatedAt?.getTime()).toBeGreaterThanOrEqual(before);
    });

    test("a Relation's equality conditions are inserted, as build() uses them", async () => {
      const db = harness.connect();
      await db.model(User).insert({ id: 1, email: "a@example.com" });
      const user = await db.model(User).find(1);

      await user.posts().insert({ title: "Hello", published: true });
      await db.model(Post).where({ userId: 1, published: false }).insert({ title: "Draft" });

      expect(await user.posts().order({ id: "asc" }).pluck("title", "published")).toEqual([
        ["Hello", true],
        ["Draft", false],
      ]);
    });

    test("inserting through the posts of an unsaved user throws RecordNotSaved", async () => {
      const user = harness.connect().model(User).build({ email: "a@example.com" });

      await expect(batch((b) => [b.insert(user.posts(), { title: "Hello" })])).rejects.toThrow(
        RecordNotSaved,
      );
    });

    test("the immediate forms reject for an unsaved owner, distinct() and no changes", async () => {
      const db = harness.connect();
      const unsaved = db.model(User).build({ email: "new@example.com" });

      await expect(unsaved.posts().insert({ title: "A", published: true })).rejects.toThrow(
        RecordNotSaved,
      );
      await expect(db.model(User).distinct().deleteAll()).rejects.toThrow(IncompatibleRelation);
      await expect(db.model(User).updateAll({})).rejects.toThrow(TypeError);
    });

    test("unknown attributes and undefined values throw when the statement is built", async () => {
      const users = harness.connect().model(User);

      await expect(batch((b) => [b.insert(users, { nope: 1 } as never)])).rejects.toThrow(
        UnknownAttribute,
      );
      await expect(batch((b) => [b.insert(users, { email: undefined } as never)])).rejects.toThrow(
        TypeError,
      );
    });

    test("a constraint failure throws the matching ConstraintViolation", async () => {
      const users = harness.connect().model(User);
      await users.insert({ id: 1, email: "a@example.com" });

      await expect(users.insert({ id: 2, email: "a@example.com" })).rejects.toThrow(
        RecordNotUnique,
      );
    });

    test("a prepared write isn't awaitable, and is only sent with its batch", async () => {
      const events: QueryEvent[] = [];
      const db = harness.connect({ onQuery: (event) => events.push(event) });

      await db.batch((b) => {
        expect("then" in b.insert(User, { email: "a@example.com" })).toBe(false);
        return [];
      });

      expect(events).toEqual([]);
      expect(await db.model(User).count()).toBe(0);
    });
  });

  describe("updateAll and deleteAll", () => {
    async function seedUsers(db: AnyDatabase): Promise<void> {
      for (const [id, role] of [
        [1, "admin"],
        [2, "member"],
        [3, "member"],
        [4, "member"],
      ] as const) {
        await db.model(User).insert({ id, email: `u${id}@example.com`, role, age: 20 });
      }
    }

    async function roles(db: AnyDatabase): Promise<unknown[]> {
      return db.model(User).order({ id: "asc" }).pluck("id", "role");
    }

    test("updateAll sets attributes on the matching rows and resolves to how many", async () => {
      const db = harness.connect();
      await seedUsers(db);

      const updated = await db.model(User).where({ role: "member" }).updateAll({ role: "guest" });

      expect(updated).toBe(3);
      expect(await roles(db)).toEqual([
        [1, "admin"],
        [2, "guest"],
        [3, "guest"],
        [4, "guest"],
      ]);
      expect(log).toEqual([]);
    });

    test("updateAll leaves updatedAt alone, as in Rails", async () => {
      const db = harness.connect();
      await db.model(User).insert({ id: 1, email: "a@example.com" });
      await db
        .model(Post)
        .insert({ id: 1, userId: 1, title: "Old", published: false, updatedAt: past });

      await db.model(Post).updateAll({ title: "New", published: true });

      const post = await db.model(Post).find(1);
      expect([post.title, post.published, post.updatedAt]).toEqual(["New", true, past]);
    });

    test("updateAll takes an sql fragment for changes that refer to columns", async () => {
      const db = harness.connect();
      await seedUsers(db);

      await db
        .model(User)
        .where({ id: [1, 2] })
        .updateAll(sql`${column("age")} = ${column("age")} + ${1}`);

      expect(await db.model(User).order({ id: "asc" }).pluck("age")).toEqual([21, 21, 20, 20]);
    });

    test("updateAll refuses no changes, unknown attributes, undefined and plain strings", async () => {
      const users = harness.connect().model(User);

      await expect(batch((b) => [b.updateAll(users, {})])).rejects.toThrow(TypeError);
      await expect(batch((b) => [b.updateAll(users, { nope: 1 } as never)])).rejects.toThrow(
        UnknownAttribute,
      );
      await expect(batch((b) => [b.updateAll(users, { role: undefined })])).rejects.toThrow(
        TypeError,
      );
      await expect(batch((b) => [b.updateAll(users, "role = 'x'" as never)])).rejects.toThrow(
        TypeError,
      );
    });

    test("deleteAll deletes the matching rows and resolves to how many", async () => {
      const db = harness.connect();
      await seedUsers(db);

      const deleted = await db.model(User).where({ role: "member" }).deleteAll();

      expect(deleted).toBe(3);
      expect(await roles(db)).toEqual([[1, "admin"]]);
    });

    test("with limit and offset, only the rows of that page are changed, in the Relation's order", async () => {
      const db = harness.connect();
      await seedUsers(db);

      await db.model(User).order({ id: "desc" }).limit(2).deleteAll();
      await db.model(User).order({ id: "asc" }).offset(1).limit(1).updateAll({ role: "x" });

      expect(await roles(db)).toEqual([
        [1, "admin"],
        [2, "x"],
      ]);
    });

    test("a fragment order with values picks the page's rows, its values bound in order", async () => {
      const db = harness.connect();
      await seedUsers(db);
      const page = db
        .model(User)
        .where({ age: 20 })
        .order(sql`${column("role")} = ${"admin"} DESC`)
        .order({ id: "desc" })
        .limit(2);

      await page.updateAll({ role: "x" });
      expect(await roles(db)).toEqual([
        [1, "x"],
        [2, "member"],
        [3, "member"],
        [4, "x"],
      ]);

      await db
        .model(User)
        .where({ age: 20 })
        .order(sql`${column("id")} = ${3} DESC`)
        .limit(1)
        .deleteAll();
      expect(await db.model(User).order({ id: "asc" }).pluck("id")).toEqual([1, 2, 4]);
    });

    test("select, includes and an order without a limit don't change which rows are written", async () => {
      const db = harness.connect();
      await seedUsers(db);

      await db
        .model(User)
        .where({ role: "member" })
        .select("email")
        .order({ id: "desc" })
        .deleteAll();
      await db.model(User).includes("posts").updateAll({ role: "owner" });

      expect(await roles(db)).toEqual([[1, "owner"]]);
    });

    test("distinct can't be written through", async () => {
      const users = harness.connect().model(User).select("role").distinct();

      await expect(batch((b) => [b.deleteAll(users)])).rejects.toThrow(IncompatibleRelation);
      await expect(batch((b) => [b.updateAll(users, { role: "x" })])).rejects.toThrow(
        IncompatibleRelation,
      );
    });

    test("on none(), deleteAll and updateAll send nothing and resolve to 0, as in Rails", async () => {
      const events: QueryEvent[] = [];
      const db = harness.connect({ onQuery: (event) => events.push(event) });
      await seedUsers(db);
      events.length = 0;

      const deleted = await db.model(User).none().deleteAll();
      const updated = await db.model(User).none().updateAll({ role: "x" });

      expect([deleted, updated]).toEqual([0, 0]);
      expect(events).toHaveLength(0);
      expect(await db.model(User).count()).toBe(4);
    });

    test("a none() statement in a batch is still sent, as WHERE 1 = 0, and changes nothing", async () => {
      const events: QueryEvent[] = [];
      const db = harness.connect({ onQuery: (event) => events.push(event) });
      await seedUsers(db);
      events.length = 0;

      const [result] = await db.batch((b) => [b.deleteAll(db.model(User).none())]);

      expect(result).toEqual({ rowsAffected: 0, rows: [] });
      expect(events.map((event) => event.sql)).toEqual([expect.stringContaining("1 = 0")]);
      expect(await db.model(User).count()).toBe(4);
    });

    describe("through a hasMany", () => {
      async function seedComments(db: AnyDatabase): Promise<void> {
        await db.model(User).insert({ id: 1, email: "a@example.com" });
        await db.model(Post).insert({ id: 1, userId: 1, title: "A", published: true });
        await db.model(Post).insert({ id: 2, userId: 1, title: "B", published: false });
        await db.model(Comment).insert({ id: 1, postId: 1, body: "one" });
        await db.model(Comment).insert({ id: 2, postId: 1, body: "two" });
        await db.model(Comment).insert({ id: 3, postId: 2, body: "three" });
      }

      async function comments(db: AnyDatabase): Promise<unknown[]> {
        return db.model(Comment).order({ id: "asc" }).pluck("id", "postId");
      }

      test("deleteAll on the association nullifies the foreign key, as Rails' has_many does", async () => {
        const db = harness.connect();
        await seedComments(db);
        const post = await db.model(Post).find(1);

        const nullified = await post.comments().deleteAll();

        expect(nullified).toBe(2);
        expect(await comments(db)).toEqual([
          [1, null],
          [2, null],
          [3, 2],
        ]);
      });

      test("deleteAll on the association raises on a NOT NULL foreign key instead of losing rows", async () => {
        const db = harness.connect();
        await seedComments(db);
        const user = await db.model(User).find(1);

        await expect(user.posts().deleteAll()).rejects.toThrow(NotNullViolation);
        expect(await db.model(Post).count()).toBe(2);
      });

      test("once the association is narrowed, deleteAll deletes, as a Rails association relation does", async () => {
        const db = harness.connect();
        await seedComments(db);
        const post = await db.model(Post).find(1);

        await post.comments().where({ body: "one" }).deleteAll();

        expect(await comments(db)).toEqual([
          [2, 1],
          [3, 2],
        ]);
      });

      test("updateAll on the association updates its records only", async () => {
        const db = harness.connect();
        await seedComments(db);
        const post = await db.model(Post).find(1);

        await post.comments().updateAll({ body: "edited" });

        expect(await db.model(Comment).order({ id: "asc" }).pluck("body")).toEqual([
          "edited",
          "edited",
          "three",
        ]);
      });

      test("writes through the association go in a batch, scoped to the owner's records", async () => {
        const db = harness.connect();
        await seedComments(db);
        const post = await db.model(Post).find(1);

        await db.batch((b) => [
          b.updateAll(post.comments(), { body: "edited" }),
          b.deleteAll(post.comments().where({ id: 2 })),
        ]);

        expect(await db.model(Comment).order({ id: "asc" }).pluck("id", "body")).toEqual([
          [1, "edited"],
          [3, "three"],
        ]);
      });

      test("a collection read while a write is in flight is loaded again once it's done", async () => {
        const { db, arm, release } = holdStatements(
          harness,
          (sql) => sql.startsWith("UPDATE"),
          "beforeRunning",
        );
        await seedComments(db);
        const post = await db.model(Post).find(1);
        arm();

        const writing = post.comments().updateAll({ body: "new" });
        expect(bodies(await post.comments().toArray())).toEqual(["one", "two"]);
        release();
        await writing;

        expect(bodies(await post.comments().toArray())).toEqual(["new", "new"]);
      });

      test("a collection read sent before a write and answered after it isn't kept", async () => {
        const { db, arm, held, release } = holdStatements(
          harness,
          reads("comments"),
          "afterRunning",
        );
        await seedComments(db);
        const post = await db.model(Post).find(1);
        arm();

        const reading = post.comments().toArray();
        await held;
        await post.comments().updateAll({ body: "new" });
        release();

        expect(bodies(await reading)).toEqual(["one", "two"]);
        expect(post.isLoaded("comments")).toBe(false);
        expect(bodies(await post.comments().toArray())).toEqual(["new", "new"]);
      });

      test("a collection read sent before a write through a where and answered after it isn't kept", async () => {
        const { db, arm, held, release } = holdStatements(
          harness,
          reads("comments"),
          "afterRunning",
        );
        await seedComments(db);
        const post = await db.model(Post).find(1);
        arm();

        const reading = post.comments().toArray();
        await held;
        await post.comments().where({ body: "one" }).updateAll({ body: "new" });
        release();

        expect(bodies(await reading)).toEqual(["one", "two"]);
        expect(bodies(await post.comments().toArray())).toEqual(["new", "two"]);
      });

      test("a collection read for a key the owner no longer holds isn't kept", async () => {
        const db = harness.connect();
        await seedComments(db);
        const post = await db.model(Post).find(1);

        const comments = post.comments();
        post.id = 2;

        expect(bodies(await comments.toArray())).toEqual(["one", "two"]);
        expect(post.isLoaded("comments")).toBe(false);
        expect(bodies(await post.comments().toArray())).toEqual(["three"]);
      });

      test("a collection read a write overtook still resolves to its rows with the records built through it", async () => {
        const { db, arm, held, release } = holdStatements(
          harness,
          reads("comments"),
          "afterRunning",
        );
        await seedComments(db);
        const post = await db.model(Post).find(1);
        post.comments().build({ body: "draft" });
        arm();

        const reading = post.comments().toArray();
        await held;
        await post.comments().updateAll({ body: "new" });
        release();

        expect(bodies(await reading)).toEqual(["one", "two", "draft"]);
        expect(post.isLoaded("comments")).toBe(false);
      });

      test("a collection read sent before a create through it and answered after it isn't kept", async () => {
        const { db, arm, held, release } = holdStatements(
          harness,
          reads("comments"),
          "afterRunning",
        );
        await seedComments(db);
        const post = await db.model(Post).find(1);
        arm();

        const reading = post.comments().toArray();
        await held;
        await post.comments().create({ id: 4, body: "four" });
        release();

        expect(bodies(await reading)).toEqual(["one", "two"]);
        expect(post.isLoaded("comments")).toBe(false);
        expect(bodies(await post.comments().toArray())).toEqual(["one", "two", "four"]);
      });

      test("a record created through a collection loaded while it saves is loaded once", async () => {
        const writesComments = (sql: string) =>
          sql.startsWith("INSERT") && sql.includes('"comments"');
        const { db, arm, held, release } = holdStatements(harness, writesComments, "afterRunning");
        await seedComments(db);
        const post = await db.model(Post).find(1);
        arm();

        const creating = post.comments().create({ id: 4, body: "four" });
        await held;
        expect(bodies(await post.comments().toArray())).toEqual(["one", "two", "four"]);
        release();
        const created = await creating;

        expect(bodies(post.loaded("comments"))).toEqual(["one", "two", "four"]);
        expect(post.loaded("comments")[2]).toBe(created);
      });

      test("a collection read sent before reload() and answered after it isn't kept", async () => {
        const { db, arm, held, release } = holdStatements(
          harness,
          reads("comments"),
          "afterRunning",
        );
        await seedComments(db);
        const post = await db.model(Post).find(1);
        arm();

        const reading = post.comments().toArray();
        await held;
        await post.reload();
        release();

        expect(bodies(await reading)).toEqual(["one", "two"]);
        expect(post.isLoaded("comments")).toBe(false);
      });

      test("reloadAssociation sent before a write and answered after it isn't kept", async () => {
        const { db, arm, held, release } = holdStatements(
          harness,
          reads("comments"),
          "afterRunning",
        );
        await seedComments(db);
        const post = await db.model(Post).find(1);
        arm();

        const reloading = post.reloadAssociation("comments");
        await held;
        await post.comments().updateAll({ body: "new" });
        release();

        expect(bodies(await reloading)).toEqual(["one", "two"]);
        expect(post.isLoaded("comments")).toBe(false);
        expect(bodies(await post.comments().toArray())).toEqual(["new", "new"]);
      });

      test("the association of an unsaved owner changes nothing", async () => {
        const db = harness.connect();
        await seedComments(db);
        const post = db.model(Post).build({ title: "New" });

        expect(await post.comments().deleteAll()).toBe(0);
        expect(await post.comments().updateAll({ body: "x" })).toBe(0);
        expect(await comments(db)).toEqual([
          [1, 1],
          [2, 1],
          [3, 2],
        ]);
      });
    });
  });

  describe("insertAll, and skipping or updating duplicates", () => {
    const post = (id: number, title: string) => ({ id, userId: 1, title, published: false });

    beforeEach(async () => {
      await harness.connect().model(User).insert({ id: 1, email: "a@example.com" });
    });

    test("insertAll writes every row in one statement, converting values and applying defaults per row", async () => {
      const events: QueryEvent[] = [];
      const db = harness.connect({ onQuery: (event) => events.push(event) });

      const { rowsAffected } = await db.model(ApiKey).insertAll([
        { label: "deploy", scopes: ["read"] },
        { label: "release", scopes: null },
      ]);

      expect(rowsAffected).toBe(2);
      expect(events).toHaveLength(1);
      const keys = await db.model(ApiKey).order({ label: "asc" }).toArray();
      expect(keys.map((key) => [key.label, key.scopes])).toEqual([
        ["deploy", ["read"]],
        ["release", null],
      ]);
      expect(new Set(keys.map((key) => key.id)).size).toBe(2);
    });

    test("datetime values are converted like any write", async () => {
      await harness
        .connect()
        .model(Post)
        .insertAll([{ ...post(1, "A"), createdAt: past }]);

      expect((await harness.connect().model(Post).find(1)).createdAt).toEqual(past);
    });

    test("createdAt and updatedAt are set on every row, as Rails' insert_all does", async () => {
      const before = Date.now();

      await harness
        .connect()
        .model(Post)
        .insertAll([post(1, "A"), post(2, "B")]);

      const stamps = await harness.connect().model(Post).pluck("createdAt", "updatedAt");
      expect(stamps.flat().every((stamp) => stamp!.getTime() >= before)).toBe(true);
    });

    test("any number of rows fits in one statement, beyond any limit on bound parameters", async () => {
      const rows = Array.from({ length: 150 }, (_, index) => post(index + 1, `Post ${index + 1}`));

      await harness.connect().model(Post).insertAll(rows);

      expect(await harness.connect().model(Post).count()).toBe(150);
    });

    test("a duplicate throws, and the statement writes nothing", async () => {
      const posts = harness.connect().model(Post);
      await posts.insert(post(1, "A"));

      await expect(posts.insertAll([post(2, "B"), post(1, "Again")])).rejects.toThrow(
        RecordNotUnique,
      );
      expect(await posts.pluck("title")).toEqual(["A"]);
    });

    test("onDuplicate: skip leaves existing rows alone and writes the rest", async () => {
      const posts = harness.connect().model(Post);
      await posts.insert(post(1, "A"));

      const result = await posts.insertAll([post(1, "Again"), post(2, "B")], {
        onDuplicate: "skip",
      });
      await posts.insert(post(2, "Again"), { onDuplicate: "skip" });

      expect(result.rowsAffected).toBe(1);
      expect(await posts.order({ id: "asc" }).pluck("title")).toEqual(["A", "B"]);
    });

    test("upsert inserts new rows and updates existing ones by primary key, keeping createdAt", async () => {
      const posts = harness.connect().model(Post);
      await posts.insert({ ...post(1, "A"), createdAt: past, updatedAt: past });
      const before = Date.now();

      const one = await posts.upsert({ ...post(1, "A2"), published: true });
      const all = await posts.upsertAll([post(2, "B")]);

      expect([one.rowsAffected, all.rowsAffected]).toEqual([1, 1]);

      const updated = await posts.find(1);
      expect([updated.title, updated.published, updated.createdAt]).toEqual(["A2", true, past]);
      expect(updated.updatedAt!.getTime()).toBeGreaterThanOrEqual(before);
      expect(await posts.order({ id: "asc" }).pluck("title")).toEqual(["A2", "B"]);
    });

    test("uniqueBy names another unique index to match on", async () => {
      const users = harness.connect().model(User);

      await users.upsertAll(
        [
          { email: "a@example.com", role: "admin" },
          { email: "b@example.com", role: "member" },
        ],
        {
          uniqueBy: "email",
        },
      );

      expect(await users.order({ email: "asc" }).pluck("id", "role")).toEqual([
        [1, "admin"],
        [expect.any(Number), "member"],
      ]);
    });

    test("upsert only updates the attributes it was given, never filled-in defaults or the key", async () => {
      class Member extends Model.define({
        id: { type: "integer", null: false, default: () => 999 },
        email: { type: "string", null: false },
        role: { type: "string", default: () => "member" },
      }) {
        static table = "users";
      }
      const members = harness.connect().model(Member);
      await members.insert({ id: 2, email: "b@example.com", role: "admin" });

      await members.upsert({ email: "b@example.com" }, { uniqueBy: "email" });

      expect(await members.where({ email: "b@example.com" }).pluck("id", "role")).toEqual([
        [2, "admin"],
      ]);
    });

    test("upsert matches on the primary key by default, even when it isn't given", async () => {
      const posts = harness.connect().model(Post);
      await posts.insert(post(1, "A"));

      await posts.upsert({ userId: 1, title: "B", published: false });

      expect(await posts.order({ id: "asc" }).pluck("title")).toEqual(["A", "B"]);
    });

    test("rows are compared as given, in any key order", async () => {
      const posts = harness.connect().model(Post);

      await expect(
        posts.insertAll([
          { id: 1, userId: 1, title: "A", published: false },
          { published: true, title: "B", userId: 1, id: 2 },
        ]),
      ).resolves.toMatchObject({ rowsAffected: 2 });
      await expect(
        batch((b) => [
          b.insertAll(posts, [{ ...post(1, "A"), createdAt: past }, { ...post(2, "B") }]),
        ]),
      ).rejects.toThrow(TypeError);
    });

    test("with nothing to insert, a skip, an upsert or several rows throw; insert({}) writes defaults", async () => {
      class Bare extends Model.define({ id: { type: "integer", null: false } }) {
        static table = "comments";
      }
      const bare = harness.connect().model(Bare);

      await expect(batch((b) => [b.insert(bare, {}, { onDuplicate: "skip" })])).rejects.toThrow(
        TypeError,
      );
      await expect(batch((b) => [b.upsert(bare, {})])).rejects.toThrow(TypeError);
      await expect(batch((b) => [b.insertAll(bare, [{}, {}])])).rejects.toThrow(TypeError);
      expect((await bare.insert({})).rowsAffected).toBe(1);
    });

    test("rows must share their attributes; an empty list and unknown attributes throw", async () => {
      const posts = harness.connect().model(Post);

      await expect(
        batch((b) => [b.insertAll(posts, [post(1, "A"), { id: 2, userId: 1, title: "B" }])]),
      ).rejects.toThrow(TypeError);
      await expect(batch((b) => [b.insertAll(posts, [])])).rejects.toThrow(TypeError);
      await expect(
        batch((b) => [b.upsertAll(posts, [post(1, "A")], { uniqueBy: "nope" as never })]),
      ).rejects.toThrow(UnknownAttribute);
    });

    test("through an association, every row gets the owner's key, and it can go in a batch", async () => {
      const db = harness.connect();
      const user = await db.model(User).find(1);

      await db.batch((b) => [
        b.insertAll(user.posts(), [
          { id: 1, title: "A", published: true },
          { id: 2, title: "B", published: false },
        ]),
      ]);

      expect(await user.posts().pluck("title")).toEqual(["A", "B"]);
    });
  });

  describe("db.batch", () => {
    test("b.insert writes a Model's row on the batch's database, resolving to its result", async () => {
      const db = harness.connect();

      const [result] = await db.batch((b) => [
        b.insert(User, { id: 1, email: "a@example.com", role: "member" }),
      ]);

      expect(result).toEqual({ rowsAffected: 1, rows: [{ id: 1 }] });
      expect(log).toEqual([]);
      expect(await db.model(User).pluck("email")).toEqual(["a@example.com"]);
    });

    test("every bulk write has a Batch method, resolving as it does alone", async () => {
      const db = harness.connect();
      await db.model(User).insertAll([
        { id: 1, email: "a@example.com" },
        { id: 2, email: "b@example.com" },
      ]);

      const results = await db.batch((b) => [
        b.insertAll(User, [
          { id: 3, email: "c@example.com" },
          { id: 4, email: "d@example.com" },
        ]),
        b.upsert(User, { id: 1, email: "a2@example.com" }),
        b.upsertAll(User, [{ id: 2, email: "b2@example.com" }], { returning: ["email"] }),
        b.updateAll(User, { role: "member" }),
        b.deleteAll(db.model(User).where({ id: 4 })),
      ]);

      expect(results).toEqual([
        { rowsAffected: 2, rows: [{ id: 3 }, { id: 4 }] },
        { rowsAffected: 1, rows: [{ id: 1 }] },
        { rowsAffected: 1, rows: [{ email: "b2@example.com" }] },
        { rowsAffected: 4, rows: [] },
        { rowsAffected: 1, rows: [] },
      ]);
      const users = await db.model(User).order({ id: "asc" }).pluck("email", "role");
      expect(users).toEqual([
        ["a2@example.com", "member"],
        ["b2@example.com", "member"],
        ["c@example.com", "member"],
      ]);
    });

    test("a Relation's writes keep its conditions and owner, as they do alone", async () => {
      const db = harness.connect();
      await db.model(User).insert({ id: 1, email: "a@example.com" });
      await db.model(Post).insert({ id: 1, userId: 1, title: "Old", published: false });
      const user = await db.model(User).find(1);

      await db.batch((b) => [
        b.insert(user.posts(), { id: 2, title: "New", published: true }),
        b.updateAll(user.posts().where({ published: false }), { title: "Draft" }),
      ]);

      const posts = await db.model(Post).order({ id: "asc" }).pluck("userId", "title");
      expect(posts).toEqual([
        [1, "Draft"],
        [1, "New"],
      ]);
    });

    test("batch's callback writes a Model's rows on the current database", async () => {
      const db = harness.connect();

      const [result] = await withDatabase(db, () =>
        batch((b) => [b.insert(User, { id: 1, email: "a@example.com" })]),
      );

      expect(result.rowsAffected).toBe(1);
      expect(await db.model(User).count()).toBe(1);
    });

    test("an async callback is refused with a TypeError, and nothing is sent", async () => {
      const events: QueryEvent[] = [];
      const db = harness.connect({ onQuery: (event) => events.push(event) });
      const asyncCallback = (async (b: Batch) => [
        b.insert(User, { id: 1, email: "a@example.com" }),
      ]) as unknown as (b: Batch) => [];

      await expect(db.batch(asyncCallback)).rejects.toThrow(
        "A batch's callback must return its writes in an array, without awaiting anything",
      );
      expect(events).toEqual([]);
    });

    test("an async callback that prepares a write after awaiting leaves no unhandled rejection", async () => {
      const db = harness.connect();
      const unhandled: unknown[] = [];
      const onUnhandled = (reason: unknown) => void unhandled.push(reason);
      process.on("unhandledRejection", onUnhandled);
      const asyncCallback = (async (b: Batch) => {
        await Promise.resolve();
        return [b.insert(User, { id: 1, email: "a@example.com" })];
      }) as unknown as (b: Batch) => [];

      await expect(db.batch(asyncCallback)).rejects.toThrow(TypeError);
      // oxlint-disable-next-line d1-record/no-fixed-delay -- Node reports an unhandled rejection a macrotask later, and nothing signals that none came
      await new Promise((resolve) => setTimeout(resolve, 10));
      process.off("unhandledRejection", onUnhandled);

      expect(unhandled).toEqual([]);
      expect(await db.model(User).count()).toBe(0);
    });

    test("a Batch used after its callback returned throws", async () => {
      const db = harness.connect();
      let kept: Batch | undefined;

      await db.batch((b) => {
        kept = b;
        return [];
      });

      expect(() => kept!.insert(User, { id: 1, email: "a@example.com" })).toThrow(
        "This Batch's callback has returned: prepare each write inside it",
      );
      expect(() => kept!.save(new User())).toThrow(TypeError);
    });

    test("runs the statements in order, atomically, and resolves to each one's result", async () => {
      const db = harness.connect();
      const userId = 7;

      const results = await db.batch((b) => [
        b.insert(User, { id: userId, email: "a@example.com", role: "member" }),
        b.insert(Post, { userId, title: "Hello", published: true }),
        b.updateAll(db.model(User).where({ id: userId }), { role: "author" }),
      ]);

      expect(results.map((result) => result.rowsAffected)).toEqual([1, 1, 1]);
      expect(results[0].rows).toEqual([{ id: userId }]);
      const user = await db.model(User).find(userId);
      expect(user.role).toBe("author");
      expect(await user.posts().pluck("title")).toEqual(["Hello"]);
    });

    test("ids generated in code link rows inside one batch", async () => {
      const db = harness.connect();
      const keyId = crypto.randomUUID();

      await db.batch((b) => [
        b.insert(ApiKey, { id: keyId, label: "deploy" }),
        b.insert(Account, { externalAccountId: keyId }),
      ]);

      const account = await db.model(Account).findByOrThrow({ externalAccountId: keyId });
      expect((await db.model(ApiKey).find(account.externalAccountId!)).label).toBe("deploy");
    });

    test("a failing statement rolls the whole batch back and throws its ConstraintViolation", async () => {
      const db = harness.connect();
      await db.model(User).insert({ id: 1, email: "a@example.com" });

      const error: unknown = await db
        .batch((b) => [
          b.insert(User, { id: 2, email: "b@example.com" }),
          b.insert(Post, { userId: 2, title: "Hello", published: true }),
          b.insert(User, { id: 3, email: "a@example.com" }),
        ])
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(RecordNotUnique);
      expect(error).toMatchObject({ table: "users", columns: ["email"], attributes: ["email"] });
      expect(await db.model(User).pluck("id")).toEqual([1]);
      expect(await db.model(Post).count()).toBe(0);
    });

    test("a constraint error that names no table is the batch's Model if it has only one", async () => {
      const db = harness.connect();

      const error: unknown = await db
        .batch((b) => [b.insert(Post, { userId: 99, title: "Orphan", published: true })])
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(InvalidForeignKey);
      expect(error).toMatchObject({ table: "posts" });
    });

    test("a constraint error names no table or columns when the batch writes to several Models", async () => {
      const db = harness.connect();

      const error: unknown = await db
        .batch((b) => [
          b.insert(User, { id: 1, email: "a@example.com" }),
          b.insert(Post, { userId: 99, title: "Orphan", published: true }),
        ])
        .catch((caught: unknown) => caught);

      expect(error).toBeInstanceOf(InvalidForeignKey);
      expect(error).toMatchObject({ table: null, columns: [], attributes: [] });
      expect((error as Error).message).toMatch(/^batch: /);
    });

    test("when a batch fails, every statement is reported with the error", async () => {
      const events: QueryEvent[] = [];
      const db = harness.connect({ onQuery: (event) => events.push(event) });

      await db
        .batch((b) => [
          b.insert(User, { id: 1, email: "a@example.com" }),
          b.insert(User, { id: 2, email: "a@example.com" }),
        ])
        .catch(() => undefined);

      expect(events).toHaveLength(2);
      expect(events.every((event) => event.error !== undefined && event.meta === undefined)).toBe(
        true,
      );
    });

    test("an empty batch sends nothing", async () => {
      const events: QueryEvent[] = [];
      const db = harness.connect({ onQuery: (event) => events.push(event) });

      expect(await db.batch(() => [])).toEqual([]);
      expect(events).toEqual([]);
    });

    test("statements built on another Database are refused", async () => {
      const db = harness.connect();
      const other = harness.connect();

      await expect(
        db.batch((b) => [b.insert(other.model(User), { email: "a@example.com" })]),
      ).rejects.toThrow(IncompatibleRelation);
      expect(await db.model(User).count()).toBe(0);
    });
  });
});
