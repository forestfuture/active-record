import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import {
  batch,
  belongsTo,
  hasMany,
  IncompatibleRelation,
  Model,
  type ScopeStatic,
  withDatabase,
} from "../../packages/active-record/src/index.ts";
import {
  d1,
  connect,
  type QueryEvent,
} from "../../packages/active-record/src/adapters/d1/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

// Level 1 reads the Worker's bindings from cloudflare:workers; here it's this test's first D1.
const workers: { env: Record<string, unknown> } = { env: {} };
vi.mock("cloudflare:workers", () => workers);

/** An app's base class for the DB binding: its generated schema names the binding. */
abstract class DbRecord extends Model {
  static override schema = { adapter: d1({ binding: "DB" }), tables: {}, models: {} };
}

class Post extends DbRecord.define({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
  published: "boolean",
}) {
  static table = "posts";
  static isPublished = this.scope((q) => q.where({ published: true }));
  // A scope that starts again from the Model's statics: on the current database.
  static everyPublished: ScopeStatic<[]> = this.scope(() => Post.where({ published: true }));

  author = belongsTo(User, { foreignKey: "userId" });
}

class User extends DbRecord.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
}) {
  static table = "users";

  posts = hasMany(Post, { foreignKey: "userId", dependent: "destroy" });

  // Counts before-callbacks, to show a refused save runs none.
  static beforeSaves = 0;
  static {
    this.beforeSave(() => {
      User.beforeSaves++;
    });
  }
}

// One database per query, write and record, whichever level it came from (#93, ADR-0012).
describe("one database", () => {
  let one: TestDatabase;
  let two: TestDatabase;
  const disposals: (() => Promise<void>)[] = [];

  beforeAll(async () => {
    for (const each of [0, 1]) {
      const { db, dispose } = await createTestDatabase();
      disposals.push(dispose);
      if (each === 0) one = db;
      else two = db;
    }
    workers.env = { DB: one };
  });
  afterAll(async () => {
    for (const dispose of disposals) await dispose();
  });
  beforeEach(async () => {
    for (const db of [one, two]) {
      await db.batch([db.prepare("DELETE FROM posts"), db.prepare("DELETE FROM users")]);
    }
    await connect(one).model(User).insert({ id: 1, email: "ada@example.com" });
    await connect(one)
      .model(Post)
      .insertAll([
        { id: 10, userId: 1, title: "Draft", published: false },
        { id: 11, userId: 1, title: "Out", published: true },
      ]);
  });

  describe("merge and or are checked when the query runs", () => {
    test("a loaded record's association combines with a static on the same database", async () => {
      const titles = await withDatabase(connect(one), async () => {
        const user = await User.find(1);
        return [
          await user.posts().merge(Post.isPublished()).pluck("title"),
          await user
            .posts()
            .or(Post.where({ title: "Draft" }))
            .order({ id: "asc" })
            .pluck("title"),
        ];
      });

      expect(titles).toEqual([["Out"], ["Draft", "Out"]]);
    });

    test("relations on two explicit databases are refused when they run, naming where each is from", async () => {
      const merged = connect(one)
        .model(Post)
        .where({ published: true })
        .merge(connect(two).model(Post).where({}));

      await expect(merged.toArray()).rejects.toThrow(
        new IncompatibleRelation(
          "merge() needs its relations on one database; these are on a connect() database and another",
        ),
      );
    });
  });

  describe("every record a write touches keeps the database it ran on", () => {
    test("records autosaved with a statics-built owner stay on the request's database", async () => {
      const seen: QueryEvent[] = [];
      const request = connect(one, { onQuery: (event) => seen.push(event) });
      let post!: Post;
      await withDatabase(request, async () => {
        const user = User.build({ id: 2, email: "grace@example.com" });
        post = user.posts().build({ id: 20, title: "Draft" });
        await user.save();
      });

      seen.length = 0;
      await post.update({ title: "Changed" });

      expect(seen.map((event) => event.sql.split(" ")[0])).toEqual(["UPDATE"]);
    });

    test("so do records autosaved in a batch", async () => {
      const seen: QueryEvent[] = [];
      let post!: Post;
      await withDatabase(connect(one, { onQuery: (event) => seen.push(event) }), async () => {
        const user = User.build({ id: 3, email: "linus@example.com" });
        post = user.posts().build({ id: 30, title: "Draft" });
        await batch([user.toSave()]);
      });

      seen.length = 0;
      await post.update({ title: "Changed" });

      expect(seen).toHaveLength(1);
    });
  });

  describe("a save is one database", () => {
    test("a belongsTo target on another database is refused before anything is written", async () => {
      const post = connect(one).model(Post).build({ id: 40, title: "Orphan" });
      post.author.set(connect(two).model(User).build({ id: 4, email: "c@example.com" }));

      await expect(post.save()).rejects.toThrow(
        new IncompatibleRelation(
          "save() needs its records on one database; these are on a connect() database and another",
        ),
      );
      for (const db of [one, two]) {
        expect(await db.prepare("SELECT count(*) AS n FROM users WHERE id = 4").first("n")).toBe(0);
        expect(await db.prepare("SELECT count(*) AS n FROM posts WHERE id = 40").first("n")).toBe(
          0,
        );
      }
    });

    test("a statics-built target saves with an owner on the same database", async () => {
      await withDatabase(connect(one), async () => {
        const post = Post.build({ id: 41, title: "Hello" });
        post.author.set(User.build({ id: 5, email: "e@example.com" }));
        expect(await post.save()).toBe(true);
      });

      expect((await connect(one).model(Post).find(41)).userId).toBe(5);
    });
  });

  describe("the rest of the levels", () => {
    test("a scope returning a static Relation works on a loaded record's association", async () => {
      const titles = await withDatabase(connect(one), async () =>
        (await User.find(1)).posts().everyPublished().pluck("title"),
      );

      expect(titles).toEqual(["Out"]);
    });

    test("an error names a binding's database as such", async () => {
      const merged = Post.where({ published: true }).merge(connect(two).model(Post).where({}));

      await expect(merged.toArray()).rejects.toThrow(
        new IncompatibleRelation(
          "merge() needs its relations on one database; these are on the DB binding's database and a connect() database",
        ),
      );
    });
  });

  describe("review fixes", () => {
    test("a save refused for two databases runs no callbacks", async () => {
      const post = connect(one).model(Post).build({ id: 42, title: "Orphan" });
      post.author.set(connect(two).model(User).build({ id: 6, email: "f@example.com" }));
      User.beforeSaves = 0;

      await expect(post.save()).rejects.toThrow(IncompatibleRelation);
      expect(User.beforeSaves).toBe(0);
    });

    test("a destroy's dependents are destroyed on the request's database", async () => {
      const seen: QueryEvent[] = [];
      await withDatabase(connect(one, { onQuery: (event) => seen.push(event) }), async () => {
        await (await User.find(1)).destroy();
      });

      expect(seen.map((event) => event.sql.split(" ").slice(0, 3).join(" "))).toEqual([
        "SELECT * FROM",
        "SELECT * FROM",
        'DELETE FROM "posts"',
        'DELETE FROM "posts"',
        'DELETE FROM "users"',
      ]);
      expect(await one.prepare("SELECT count(*) AS n FROM posts").first("n")).toBe(0);
    });

    test("a record built on a combined Relation is saved on, and keeps, its one database", async () => {
      const seen: QueryEvent[] = [];
      let post!: Post;
      await withDatabase(connect(one, { onQuery: (event) => seen.push(event) }), async () => {
        const user = await User.find(1);
        post = user.posts().merge(Post.isPublished()).build({ id: 43, title: "New" });
        await post.save();
      });

      seen.length = 0;
      await post.update({ title: "Changed" });
      expect(seen).toHaveLength(1);
    });

    test("an error names the request's database as such", async () => {
      const user = await User.find(1); // through the binding
      const merged = await withDatabase(connect(one), async () =>
        user
          .posts()
          .merge(Post.isPublished())
          .toArray()
          .catch((error: unknown) => error),
      );

      expect(merged).toEqual(
        new IncompatibleRelation(
          "merge() needs its relations on one database; these are on the DB binding's database and the request's database",
        ),
      );
    });

    test("a request's database used explicitly inside withDatabase is still the request's", async () => {
      const request = connect(one);

      const merged = withDatabase(request, async () =>
        request.model(Post).where({}).merge(connect(two).model(Post).where({})).toArray(),
      );

      await expect(merged).rejects.toThrow(
        new IncompatibleRelation(
          "merge() needs its relations on one database; these are on the request's database and a connect() database",
        ),
      );
    });

    test("a database given to withDatabase is the request's for its life, even outside it", async () => {
      const request = connect(one);
      await withDatabase(request, async () => {
        // Nothing to run: giving the database to withDatabase is what's under test.
      });

      const merged = request.model(Post).where({}).merge(connect(two).model(Post).where({}));

      await expect(merged.toArray()).rejects.toThrow(
        new IncompatibleRelation(
          "merge() needs its relations on one database; these are on the request's database and a connect() database",
        ),
      );
    });

    test("databases of two requests are both the request's, so the error says another", async () => {
      const first = connect(one);
      const second = connect(two);
      const user = await withDatabase(first, () => User.find(1));
      await withDatabase(second, async () => {
        // Nothing to run: the second request's database only has to be one withDatabase was given.
      });

      const merged = user.posts().merge(second.model(Post).where({}));

      await expect(merged.toArray()).rejects.toThrow(
        new IncompatibleRelation(
          "merge() needs its relations on one database; these are on the request's database and another",
        ),
      );
    });

    test("a record loaded in withDatabase names its database as the request's after it", async () => {
      const user = await withDatabase(connect(one), () => User.find(1));

      const merged = user.posts().merge(Post.isPublished());

      await expect(merged.toArray()).rejects.toThrow(
        new IncompatibleRelation(
          "merge() needs its relations on one database; these are on the request's database and the DB binding's database",
        ),
      );
    });

    test("every database given to withDatabase, even one no Model's binding matches or a nested call adds, is the request's", async () => {
      const mismatched = connect(two);
      const merged = (relation: Promise<unknown>) =>
        expect(relation).rejects.toThrow(
          new IncompatibleRelation(
            "merge() needs its relations on one database; these are on the request's database and another",
          ),
        );

      await withDatabase([connect(one), mismatched], async () => {
        const outer = Post.where({});
        await withDatabase(connect(one), async () => {
          const nested = Post.where({});
          await merged(nested.merge(mismatched.model(Post).where({})).toArray());
          await merged(outer.merge(mismatched.model(Post).where({})).toArray());
        });
      });
      await expect(
        mismatched.model(Post).where({}).merge(connect(one).model(Post).where({})).toArray(),
      ).rejects.toThrow(
        new IncompatibleRelation(
          "merge() needs its relations on one database; these are on the request's database and a connect() database",
        ),
      );
    });

    test("db.batch() names itself, and a static outside withDatabase is on the binding's database", async () => {
      const db = connect(one);

      await expect(db.batch([Post.where({ id: 10 }).toDeleteAll()])).rejects.toThrow(
        new IncompatibleRelation(
          "db.batch() needs its statements and records on one database; these are on a connect() database and the DB binding's database",
        ),
      );
      expect(
        await withDatabase(db, () => db.batch([Post.where({ id: 10 }).toDeleteAll()])),
      ).toHaveLength(1);
    });
  });
});
