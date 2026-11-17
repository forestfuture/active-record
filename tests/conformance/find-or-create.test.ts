import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  belongsTo,
  hasMany,
  IncompatibleRelation,
  Model,
  RecordInvalid,
  RecordNotFound,
  RecordNotUnique,
  UnknownAttribute,
} from "../../packages/active-record/src/index.ts";
import type { QueryEvent } from "../../packages/active-record/src/executor.ts";
import { openHarness, type Harness } from "../support/harness.ts";
import { statementKinds } from "../support/statement-kinds.ts";

class Post extends Model.define({
  id: { type: "integer", null: false },
  userId: "integer",
  title: "string",
}) {
  static table = "posts";

  author = belongsTo(User, { foreignKey: "userId", optional: true });
}

class User extends Model.define({
  id: { type: "integer", null: false },
  email: "string",
  role: "string",
  age: "integer",
  createdAt: "datetime",
}) {
  static table = "users";
  static admins = this.scope((q) => q.where({ role: "admin" }));

  posts = hasMany(Post, { foreignKey: "userId" });

  static {
    this.validates("email", { presence: true });
  }
}

describe("making records", () => {
  let harness: Harness;
  const events: QueryEvent[] = [];
  const db = () => harness.connect({ onQuery: (event) => events.push(event) });
  const emails = async () =>
    (await harness.exec("SELECT email, role FROM users ORDER BY id")).map(({ email, role }) => ({
      email,
      role,
    }));

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.reset("posts", "users");
    await harness.exec(
      "INSERT INTO users (id, email, role) VALUES (1, 'taken@example.com', 'admin')",
    );
    events.length = 0;
  });

  describe("init", () => {
    test("build hands init the new record, its attributes assigned, before returning it", () => {
      const seen: unknown[] = [];

      const user = db()
        .model(User)
        .build({ email: "new@example.com" }, (record) => {
          seen.push(record.email);
          record.role = "member";
        });

      expect(seen).toEqual(["new@example.com"]);
      expect(user.role).toBe("member");
      expect(user.isNewRecord()).toBe(true);
    });

    test("create awaits init before saving, so what it sets is saved", async () => {
      const user = await db()
        .model(User)
        .create({ email: "new@example.com" }, async (record) => {
          await Promise.resolve();
          record.role = "member";
        });

      expect(user.isPersisted()).toBe(true);
      expect(await emails()).toContainEqual({ email: "new@example.com", role: "member" });
    });

    test("createOrThrow awaits init before saving, so what it sets is saved", async () => {
      await db()
        .model(User)
        .createOrThrow({ email: "new@example.com" }, (record) => {
          record.role = "member";
        });

      expect(await emails()).toContainEqual({ email: "new@example.com", role: "member" });
      expect(statementKinds(events)).toEqual(["INSERT"]);
    });
  });

  describe("findOrCreateBy", () => {
    test("finds the row with the attributes, and writes nothing", async () => {
      const user = await db().model(User).findOrCreateBy({ email: "taken@example.com" });

      expect(user.id).toBe(1);
      expect(user.role).toBe("admin");
      expect(statementKinds(events)).toEqual(["SELECT"]);
    });

    test("creates a row with the attributes when none has them", async () => {
      const user = await db()
        .model(User)
        .findOrCreateBy({ email: "new@example.com", role: "member" });

      expect(user.isPersisted()).toBe(true);
      expect(await emails()).toContainEqual({ email: "new@example.com", role: "member" });
      expect(statementKinds(events)).toEqual(["SELECT", "INSERT"]);
    });

    test("hands init the record it creates, before saving it", async () => {
      await db()
        .model(User)
        .findOrCreateBy({ email: "new@example.com" }, (user) => {
          user.role = "member";
        });

      expect(await emails()).toContainEqual({ email: "new@example.com", role: "member" });
    });

    test("doesn't call init when it finds the row", async () => {
      const calls: unknown[] = [];

      await db()
        .model(User)
        .findOrCreateBy({ email: "taken@example.com" }, (user) => void calls.push(user));

      expect(calls).toEqual([]);
    });

    test("resolves to the unsaved record when it can't be saved", async () => {
      const user = await db().model(User).findOrCreateBy({ email: null, role: "member" });

      expect(user.isNewRecord()).toBe(true);
      expect(user.errors.get("email")).toEqual(["can't be blank"]);
      expect(statementKinds(events)).toEqual(["SELECT"]);
    });
  });

  describe("findOrCreateByOrThrow", () => {
    test("finds the row with the attributes, and writes nothing", async () => {
      const user = await db().model(User).findOrCreateByOrThrow({ email: "taken@example.com" });

      expect(user.id).toBe(1);
      expect(statementKinds(events)).toEqual(["SELECT"]);
    });

    test("creates a row with the attributes when none has them, handing it to init", async () => {
      await db()
        .model(User)
        .findOrCreateByOrThrow({ email: "new@example.com" }, (user) => {
          user.role = "member";
        });

      expect(await emails()).toContainEqual({ email: "new@example.com", role: "member" });
    });

    test("throws RecordInvalid when the record it creates can't be saved", async () => {
      await expect(db().model(User).findOrCreateByOrThrow({ email: null })).rejects.toThrow(
        RecordInvalid,
      );
    });
  });

  describe("findOrInitializeBy", () => {
    test("finds the row with the attributes", async () => {
      const user = await db().model(User).findOrInitializeBy({ email: "taken@example.com" });

      expect(user.id).toBe(1);
      expect(user.isPersisted()).toBe(true);
    });

    test("builds a record with the attributes, awaiting init, and writes nothing", async () => {
      const user = await db()
        .model(User)
        .findOrInitializeBy({ email: "new@example.com" }, async (record) => {
          await Promise.resolve();
          record.role = "member";
        });

      expect(user.isNewRecord()).toBe(true);
      expect({ email: user.email, role: user.role }).toEqual({
        email: "new@example.com",
        role: "member",
      });
      expect(statementKinds(events)).toEqual(["SELECT"]);
    });

    test("doesn't call init when it finds the row", async () => {
      const calls: unknown[] = [];

      await db()
        .model(User)
        .findOrInitializeBy({ email: "taken@example.com" }, (user) => void calls.push(user));

      expect(calls).toEqual([]);
    });
  });

  describe("createOrFindBy", () => {
    test("creates a row with the attributes, without looking for one first", async () => {
      const user = await db()
        .model(User)
        .createOrFindBy({ email: "new@example.com" }, (record) => {
          record.role = "member";
        });

      expect(user.isPersisted()).toBe(true);
      expect(await emails()).toContainEqual({ email: "new@example.com", role: "member" });
      expect(statementKinds(events)).toEqual(["INSERT"]);
    });

    test("finds the row a unique index refused a duplicate of", async () => {
      const user = await db().model(User).createOrFindBy({ email: "taken@example.com" });

      expect(user.id).toBe(1);
      expect(user.role).toBe("admin");
      expect(statementKinds(events)).toEqual(["INSERT", "SELECT"]);
    });

    test("resolves to the unsaved record, without finding, when it can't be saved", async () => {
      const user = await db().model(User).createOrFindBy({ email: null });

      expect(user.isNewRecord()).toBe(true);
      expect(statementKinds(events)).toEqual([]);
    });

    test("throws the RecordNotUnique of another record it saves, rather than finding its own", async () => {
      await harness.exec("INSERT INTO posts (id, user_id, title) VALUES (1, 1, 'Hello')");

      const creating = db()
        .model(User)
        .createOrFindBy({ email: "new@example.com" }, (user) => {
          user.posts().build({ id: 1, title: "Clashing" });
        });

      await expect(creating).rejects.toThrow(RecordNotUnique);
    });

    test("throws the RecordNotUnique of a record saved before it, rather than finding one", async () => {
      await harness.exec("INSERT INTO posts (id, user_id, title) VALUES (1, 1, 'Hello')");

      const creating = db()
        .model(Post)
        .createOrFindBy({ title: "Hello" }, (post) => {
          post.author.build({ email: "taken@example.com" });
        });

      await expect(creating).rejects.toThrow(RecordNotUnique);
    });

    test("throws RecordNotFound when the duplicate was in a column the attributes don't name", async () => {
      const creating = db()
        .model(User)
        .createOrFindBy({ email: "new@example.com" }, (user) => {
          user.id = 1;
        });

      await expect(creating).rejects.toThrow(RecordNotFound);
    });
  });

  describe("createOrFindByOrThrow", () => {
    test("creates a row with the attributes, handing it to init", async () => {
      await db()
        .model(User)
        .createOrFindByOrThrow({ email: "new@example.com" }, (record) => {
          record.role = "member";
        });

      expect(await emails()).toContainEqual({ email: "new@example.com", role: "member" });
    });

    test("finds the row a unique index refused a duplicate of", async () => {
      const user = await db().model(User).createOrFindByOrThrow({ email: "taken@example.com" });

      expect(user.id).toBe(1);
      expect(statementKinds(events)).toEqual(["INSERT", "SELECT"]);
    });

    test("throws RecordInvalid when the record can't be saved", async () => {
      await expect(db().model(User).createOrFindByOrThrow({ email: null })).rejects.toThrow(
        RecordInvalid,
      );
    });
  });

  describe("createWith", () => {
    test("gives a record findOrCreateBy creates its attributes, which finding doesn't use", async () => {
      const users = db().model(User).createWith({ role: "member" });

      const found = await users.findOrCreateBy({ email: "taken@example.com" });
      const created = await users.findOrCreateBy({ email: "new@example.com" });

      expect(found.role).toBe("admin");
      expect(await emails()).toContainEqual({ email: "new@example.com", role: "member" });
      expect(created.isPersisted()).toBe(true);
    });

    test("wins over the Relation's conditions, and loses to the attributes given", () => {
      const users = db()
        .model(User)
        .where({ role: "admin", age: 30 })
        .createWith({ role: "member" });

      expect(users.build().role).toBe("member");
      expect(users.build({ role: "owner" }).role).toBe("owner");
      expect(users.build().age).toBe(30);
    });

    test("adds to an earlier createWith, and null clears both", () => {
      const users = db().model(User).createWith({ role: "member" }).createWith({ age: 30 });

      expect({ role: users.build().role, age: users.build().age }).toEqual({
        role: "member",
        age: 30,
      });
      expect(users.createWith(null).build().role).toBeNull();
    });

    test("gives the rows insert writes its attributes", async () => {
      await db().model(User).createWith({ role: "member" }).insert({ email: "new@example.com" });

      expect(await emails()).toContainEqual({ email: "new@example.com", role: "member" });
    });

    test("gives the rows insertAll writes its attributes", async () => {
      await db()
        .model(User)
        .createWith({ role: "member" })
        .insertAll([{ email: "a@example.com" }, { email: "b@example.com" }]);

      expect(await emails()).toEqual(
        expect.arrayContaining([
          { email: "a@example.com", role: "member" },
          { email: "b@example.com", role: "member" },
        ]),
      );
    });

    test("gives the row upsert inserts its attributes", async () => {
      await db()
        .model(User)
        .createWith({ role: "member" })
        .upsert({ id: 2, email: "new@example.com" });

      expect(await emails()).toContainEqual({ email: "new@example.com", role: "member" });
    });

    test("gives the rows upsertAll inserts its attributes", async () => {
      await db()
        .model(User)
        .createWith({ role: "member" })
        .upsertAll([{ id: 2, email: "new@example.com" }]);

      expect(await emails()).toContainEqual({ email: "new@example.com", role: "member" });
    });

    test("is laid over by the merged Relation's", () => {
      const users = db().model(User);

      const merged = users
        .createWith({ role: "member", age: 30 })
        .merge(users.createWith({ role: "owner" }));

      expect({ role: merged.build().role, age: merged.build().age }).toEqual({
        role: "owner",
        age: 30,
      });
    });

    test("must be the same on both sides of or()", () => {
      const users = db().model(User);

      expect(() =>
        users
          .createWith({ role: "member" })
          .where({ age: 1 })
          .or(users.where({ age: 2 })),
      ).toThrow(IncompatibleRelation);
    });

    test("is the same on both sides of or() when its values are equal, a date's by its time", () => {
      const users = db().model(User);
      const start = () => users.createWith({ createdAt: new Date("2026-01-02T00:00:00Z") });

      const either = start()
        .where({ age: 1 })
        .or(start().where({ age: 2 }));

      expect(either.build().createdAt).toEqual(new Date("2026-01-02T00:00:00Z"));
    });

    test("refuses an attribute the Model doesn't have", () => {
      expect(() =>
        db()
          .model(User)
          .createWith({ nickname: "x" } as never),
      ).toThrow(UnknownAttribute);
    });
  });

  describe("through a scope or an association", () => {
    test("a scope's conditions are the attributes of the record it creates", async () => {
      await db().model(User).admins().findOrCreateBy({ email: "new@example.com" });

      expect(await emails()).toContainEqual({ email: "new@example.com", role: "admin" });
    });

    test("a hasMany's findOrCreateBy finds only its owner's records, and creates one for its owner", async () => {
      await harness.exec("INSERT INTO users (id, email) VALUES (2, 'other@example.com')");
      await harness.exec("INSERT INTO posts (id, user_id, title) VALUES (1, 2, 'Hello')");
      const user = await db().model(User).find(1);

      const post = await user.posts().findOrCreateBy({ title: "Hello" });

      expect(post.id).not.toBe(1);
      expect(post.userId).toBe(1);
      expect(post.isPersisted()).toBe(true);
    });

    test("a record a loaded hasMany creates joins what it has loaded", async () => {
      const user = await db().model(User).find(1);
      await user.posts().toArray();

      const post = await user.posts().createOrFindBy({ title: "Hello" });
      events.length = 0;

      expect(await user.posts().toArray()).toEqual([post]);
      expect(events).toEqual([]);
    });

    test("a record whose init throws doesn't join the hasMany it's built through", async () => {
      const user = await db().model(User).find(1);
      const failure = new Error("no title to give");

      expect(() =>
        user.posts().build({}, () => {
          throw failure;
        }),
      ).toThrow(failure);

      expect(await user.posts().size()).toBe(0);
    });

    test("a record whose init rejects doesn't join the hasMany findOrInitializeBy builds it through", async () => {
      const user = await db().model(User).find(1);
      const failure = new Error("no title to give");

      const initializing = user.posts().findOrInitializeBy({ title: "Hello" }, async () => {
        throw failure;
      });

      await expect(initializing).rejects.toBe(failure);
      expect(await user.posts().size()).toBe(0);
    });

    test("a hasMany inserts rows with its owner's key over the one given", async () => {
      await harness.exec("INSERT INTO users (id, email) VALUES (2, 'other@example.com')");
      const user = await db().model(User).find(1);

      await user.posts().insert({ userId: 2, title: "Hello" });

      expect(await harness.exec("SELECT user_id FROM posts")).toEqual([{ user_id: 1 }]);
    });

    test("a hasMany's owner key wins over createWith", async () => {
      const user = await db().model(User).find(1);

      const post = user.posts().createWith({ userId: 2 }).build();

      expect(post.userId).toBe(1);
    });
  });

  describe("a row inserted between finding and creating", () => {
    const insertAnother = () =>
      harness.exec("INSERT INTO users (id, email, role) VALUES (2, 'new@example.com', 'other')");

    test("is what createOrFindBy finds", async () => {
      const user = await db()
        .model(User)
        .createOrFindBy({ email: "new@example.com" }, () => insertAnother().then(() => {}));

      expect(user.id).toBe(2);
      expect(user.role).toBe("other");
    });

    test("makes findOrCreateByOrThrow throw RecordNotUnique", async () => {
      const finding = db()
        .model(User)
        .findOrCreateByOrThrow({ email: "new@example.com" }, () => insertAnother().then(() => {}));

      await expect(finding).rejects.toThrow(RecordNotUnique);
    });

    test("makes findOrCreateBy throw RecordNotUnique", async () => {
      const finding = db()
        .model(User)
        .findOrCreateBy({ email: "new@example.com" }, () => insertAnother().then(() => {}));

      await expect(finding).rejects.toThrow(RecordNotUnique);
    });
  });
});
