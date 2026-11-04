import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  belongsTo,
  hasMany,
  IncompatibleRelation,
  InvalidModel,
  Model,
  sql,
  column,
  withDatabase,
} from "../../src/index.ts";
import type { QueryEvent } from "../../src/executor.ts";
import { openHarness, type Harness } from "../support/harness.ts";

class User extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
}) {
  static table = "users";

  posts = hasMany(Post, { foreignKey: "userId" });
}

class Post extends Model.define({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
}) {
  static table = "posts";
  static titledAfter = this.scope((q, title: string) =>
    q.where(sql`${column("title")} > ${title}`),
  );

  user = belongsTo(User, { foreignKey: "userId" });
}

describe("paginate", () => {
  let harness: Harness;
  const events: QueryEvent[] = [];
  // Made afresh for each test, so its batches are that test's.
  const db = () => harness.connect({ onQuery: (event) => events.push(event) });
  const titles = (records: readonly Post[]) => records.map((post) => post.title);

  beforeAll(async () => {
    // Read backwards for a descending order, its index gives tied rows in reverse key order.
    harness = await openHarness({ schema: "paginated" });
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.reset("posts", "users");
    await harness.exec("INSERT INTO users (id, email) VALUES (1, 'a@example.com')");
    await harness.exec(
      "INSERT INTO posts (id, user_id, title) VALUES (5, 1, 'E'), (3, 1, 'C'), (1, 1, 'A'), (4, 1, 'D'), (2, 1, 'B')",
    );
    events.length = 0;
  });

  test("keeps the Relation's conditions and order", async () => {
    const page = await db()
      .model(Post)
      .where({ id: [1, 2, 3, 4] })
      .order({ title: "desc" })
      .paginate({ page: 1, perPage: 3 });

    expect(titles(page.records)).toEqual(["D", "C", "B"]);
    expect([page.total, page.totalPages, page.hasNext, page.hasPrevious]).toEqual([
      4,
      2,
      true,
      false,
    ]);
  });

  test("past the last page, has no records but the real total", async () => {
    const page = await db().model(Post).paginate({ page: 9, perPage: 2 });

    expect(page.records).toEqual([]);
    expect([page.total, page.totalPages, page.hasNext, page.hasPrevious]).toEqual([
      5,
      3,
      false,
      true,
    ]);
  });

  describe("with { count: false }", () => {
    test("on the last page, has no next", async () => {
      const page = await db().model(Post).paginate({ page: 3, perPage: 2, count: false });

      expect(titles(page.records)).toEqual(["E"]);
      expect(page.hasNext).toBe(false);
    });
  });

  describe("untrusted page and perPage", () => {
    test("are cast as an integer attribute is", async () => {
      const page = await db().model(Post).paginate({ page: "2", perPage: " 2 " });

      expect(titles(page.records)).toEqual(["C", "D"]);
      expect([page.page, page.perPage]).toEqual([2, 2]);
    });

    test("missing, null or empty, are the first page and the default size", async () => {
      const params = new URLSearchParams("page=");
      const pages = [
        await db().model(Post).paginate(),
        await db().model(Post).paginate({ page: null, perPage: null }),
        await db()
          .model(Post)
          .paginate({ page: params.get("page"), perPage: params.get("per") }),
      ];

      expect(pages.map(({ page, perPage }) => [page, perPage])).toEqual([
        [1, 25],
        [1, 25],
        [1, 25],
      ]);
    });

    test.each(["abc", "1.5", 1.5, "1e3", 0, "-1", Number.NaN])(
      "%s throws TypeError, as a page or a perPage",
      async (value) => {
        const posts = db().model(Post);

        await expect(posts.paginate({ page: value })).rejects.toThrow(TypeError);
        await expect(posts.paginate({ perPage: value })).rejects.toThrow(TypeError);
        expect(events).toEqual([]);
      },
    );

    test.each([[[2]], [["2"]], [{}], [true]])(
      "%j from a JSON body throws TypeError, as a page or a perPage",
      async (value) => {
        const posts = db().model(Post);
        // A JSON body's value can be any JSON, whatever the type says.
        const untyped = value as unknown as number;

        await expect(posts.paginate({ page: untyped })).rejects.toThrow(TypeError);
        await expect(posts.paginate({ perPage: untyped })).rejects.toThrow(TypeError);
        expect(events).toEqual([]);
      },
    );

    test("a page too far to be skipped to exactly throws TypeError", async () => {
      const posts = db().model(Post);
      const page = String(Number.MAX_SAFE_INTEGER);

      await expect(posts.paginate({ page, perPage: 2 })).rejects.toThrow(TypeError);
      await expect(posts.paginate({ page, count: false })).rejects.toThrow(TypeError);
      expect(events).toEqual([]);
    });
  });

  describe("perPage and maxPerPage", () => {
    test("default to 25 and 100", () => {
      expect([Model.perPage, Model.maxPerPage]).toEqual([25, 100]);
    });

    test.each([
      ["perPage", 0],
      ["perPage", 2.5],
      ["maxPerPage", Number.POSITIVE_INFINITY],
      ["maxPerPage", Number.NaN],
    ])("a %s of %s is an InvalidModel", (name, value) => {
      class Odd extends Post {}
      Object.defineProperty(Odd, name, { value });

      expect(() => db().model(Odd)).toThrow(InvalidModel);
      expect(() => db().model(Odd)).toThrow(new RegExp(`Odd's ${name}`));
    });

    test("a larger perPage is capped at maxPerPage, without throwing", async () => {
      const page = await db().model(Post).paginate({ perPage: 1000 });

      expect(page.perPage).toBe(100);
    });

    test("set on an app's base class, every Model built on it inherits them", async () => {
      abstract class Base extends Model {
        static override perPage = 2;
        static override maxPerPage = 3;
      }
      const PostRecord = Base.define({ id: "integer", userId: "integer", title: "string" });
      class Article extends PostRecord {
        static override table = "posts";
      }
      class Brief extends PostRecord {
        static override table = "posts";
        static override perPage = 9;
      }

      const pages = [
        await db().model(Article).paginate(),
        await db().model(Article).paginate({ perPage: 4 }),
        await db().model(Brief).paginate(),
      ];

      expect(pages.map(({ perPage }) => perPage)).toEqual([2, 3, 3]);
      expect(pages[0]?.records.map(({ title }) => title)).toEqual(["A", "B"]);
    });
  });

  test("a Relation with its own limit or offset rejects with IncompatibleRelation", async () => {
    const posts = db().model(Post);

    await expect(posts.limit(2).paginate()).rejects.toThrow(IncompatibleRelation);
    await expect(posts.offset(2).paginate({ count: false })).rejects.toThrow(IncompatibleRelation);
    expect(events).toEqual([]);
  });

  test("on none(), is an empty page, without a query", async () => {
    const posts = db().model(Post).none();

    const [counted, countless] = [
      await posts.paginate({ page: 2 }),
      await posts.paginate({ count: false }),
    ];

    expect(counted).toEqual({
      records: [],
      page: 2,
      perPage: 25,
      total: 0,
      totalPages: 0,
      hasNext: false,
      hasPrevious: true,
    });
    expect(countless).toEqual({
      records: [],
      page: 1,
      perPage: 25,
      hasNext: false,
      hasPrevious: false,
    });
    expect(events).toEqual([]);
  });

  test("is a static of every Model, and carries scopes", async () => {
    const page = await withDatabase(db(), () =>
      Post.titledAfter("B").paginate({ perPage: 2, count: false }),
    );
    const total = (await withDatabase(db(), () => Post.paginate())).total;

    expect(titles(page.records)).toEqual(["C", "D"]);
    expect(total).toBe(5);
  });

  test("on a hasMany, queries the database, leaving out the owner's loaded and unsaved built records", async () => {
    const user = await db().model(User).includes("posts").findByOrThrow({ id: 1 });
    user.posts().build({ title: "0 unsaved" });
    events.length = 0;

    const page = await user.posts().paginate({ perPage: 2 });

    expect([titles(page.records), page.total]).toEqual([["A", "B"], 5]);
    expect(events).toHaveLength(2);
  });

  test("on a hasMany, counts only the owner's records", async () => {
    await harness.exec("INSERT INTO users (id, email) VALUES (2, 'b@example.com')");
    await harness.exec("INSERT INTO posts (id, user_id, title) VALUES (6, 2, 'F')");
    const user = await db().model(User).findByOrThrow({ id: 2 });

    const page = await user.posts().paginate();

    expect([titles(page.records), page.total]).toEqual([["F"], 1]);
  });

  test("with select() and distinct(), the total counts what the pages hold", async () => {
    const page = await db().model(Post).select("userId").distinct().paginate();

    expect([page.records.map(({ userId }) => userId), page.total]).toEqual([[1], 1]);
  });

  test("ends the Relation's order with the primary key, so tied records keep their pages", async () => {
    const posts = db().model(Post).order({ userId: "desc" });

    const pages = [
      await posts.paginate({ page: 1, perPage: 2 }),
      await posts.paginate({ page: 2, perPage: 2, count: false }),
    ];

    expect(pages.map(({ records }) => titles(records))).toEqual([
      ["A", "B"],
      ["C", "D"],
    ]);
  });

  test("after distinct(), with no order, pages sort by the selected attributes", async () => {
    await harness.exec("INSERT INTO users (id, email) VALUES (2, 'b@example.com')");
    await harness.exec("UPDATE posts SET user_id = 2 WHERE id IN (1, 3)");
    const userIds = db().model(Post).select("userId").distinct();

    const pages = [
      await userIds.paginate({ page: 1, perPage: 1 }),
      await userIds.paginate({ page: 2, perPage: 1 }),
    ];

    expect(pages.map(({ records }) => records.map(({ userId }) => userId))).toEqual([[1], [2]]);
  });
});
