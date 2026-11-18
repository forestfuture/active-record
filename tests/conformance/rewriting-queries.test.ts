import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import {
  belongsTo,
  column,
  gte,
  hasMany,
  IncompatibleRelation,
  Model,
  sql,
  UnknownAttribute,
} from "../../packages/active-record/src/index.ts";
import type { QueryEvent } from "../../packages/active-record/src/executor.ts";
import { openHarness, type Harness } from "../support/harness.ts";

class User extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  role: "string",
  age: "integer",
}) {
  static table = "users";

  posts = hasMany(Post);
}

class Post extends Model.define({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
}) {
  static table = "posts";

  user = belongsTo(User);
}

describe("rewriting queries (#350)", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await openHarness();
    await harness.exec(`INSERT INTO users (id, email, role, age) VALUES
           (1, 'a@example.com', 'admin', 30),
           (2, 'b@example.com', 'member', 40),
           (3, 'c@example.com', 'member', 30),
           (4, 'd@example.com', NULL, 50)`);
    await harness.exec("INSERT INTO posts (id, user_id, title) VALUES (10, 1, 'A'), (11, 2, 'B')");
  });
  afterAll(() => harness.dispose());

  const users = () => harness.connect().model(User);

  describe("rewhere", () => {
    test("replaces the conditions on its attributes, keeping the others", async () => {
      const members = users().where({ role: "member", age: 30 });

      expect(await members.rewhere({ role: "admin" }).pluck("id")).toEqual([1]);
    });

    test("replaces lists, comparisons, whereNot and or on only its attributes", async () => {
      const all = users();
      const replaced = all
        .where({ age: gte(40) })
        .whereNot({ age: 50 })
        .or(all.where({ age: [30] }))
        .rewhere({ age: 30 })
        .order({ id: "asc" });

      expect(await replaced.pluck("id")).toEqual([1, 3]);
    });

    test("keeps fragments, and a whereNot or or naming more attributes than its own", async () => {
      const kept = users()
        .where(sql`${column("id")} > 1`)
        .whereNot({ role: "member", age: 40 })
        .rewhere({ age: 30 })
        .order({ id: "asc" });

      expect(await kept.pluck("id")).toEqual([3]);
    });

    test("replaces a default scope's condition on its attribute", async () => {
      class Member extends User {
        static {
          this.defaultScope((q) => q.where({ role: "member" }));
        }
      }

      const admins = harness.connect().model(Member).rewhere({ role: "admin" });

      expect(await admins.pluck("id")).toEqual([1]);
    });

    test("is a where when nothing names its attributes", async () => {
      expect(await users().rewhere({ role: "admin" }).pluck("id")).toEqual([1]);
    });

    test("refuses a fragment, which names no attributes", () => {
      // @ts-expect-error -- rewhere takes attribute values only
      expect(() => users().rewhere(sql`${column("age")} = 30`)).toThrow(TypeError);
    });
  });

  describe("unscope", () => {
    test("drops every condition, a default scope's included", async () => {
      class Member extends User {
        static {
          this.defaultScope((q) => q.where({ role: "member" }));
        }
      }

      const everyone = harness.connect().model(Member).where({ age: 30 }).unscope("where");

      expect(await everyone.order({ id: "asc" }).pluck("id")).toEqual([1, 2, 3, 4]);
    });

    test("drops the order, page, select and distinct it names", async () => {
      const narrowed = users().order({ id: "desc" }).limit(1).offset(1).select("email").distinct();

      const all = await narrowed
        .unscope("order", "limit", "offset", "select", "distinct")
        .toArray();

      expect(all.map((user) => user.id).sort((a, b) => a - b)).toEqual([1, 2, 3, 4]);
      expect(all.map((user) => user.role)).toContain("admin");
    });

    test("drops the joins of the kind it names", async () => {
      expect(await users().joins("posts").unscope("joins").count()).toBe(4);
      expect(await users().joins("posts").unscope("leftJoins").count()).toBe(2);
      expect(await users().leftJoins("posts").unscope("leftJoins").count()).toBe(4);
    });

    test("refuses to drop a join that conditions merged onto it use", () => {
      const db = harness.connect();
      const joined = db
        .model(User)
        .joins("posts")
        .merge(db.model(Post).where({ title: "A" }));

      expect(() => joined.unscope("joins")).toThrow(IncompatibleRelation);
    });

    test("drops includes and createWith", async () => {
      const [user] = await users().includes("posts").unscope("includes").where({ id: 1 }).toArray();
      const built = users().createWith({ role: "guest" }).unscope("createWith").build();

      expect(user?.isLoaded("posts")).toBe(false);
      expect(built.role).toBeNull();
    });

    test("with { where } drops only the conditions on those attributes", async () => {
      const members = users().where({ role: "member", age: 30 });

      expect(await members.unscope({ where: "role" }).order({ id: "asc" }).pluck("id")).toEqual([
        1, 3,
      ]);
      expect(await members.unscope({ where: ["role", "age"] }).count()).toBe(4);
    });

    test("refuses a part it doesn't know, and an attribute the Model doesn't have", () => {
      // @ts-expect-error -- not a part unscope drops
      expect(() => users().unscope("group")).toThrow(TypeError);
      // @ts-expect-error -- not an attribute of User
      expect(() => users().unscope({ where: "nope" })).toThrow(UnknownAttribute);
    });
  });

  describe("only", () => {
    test("keeps only the parts it names", async () => {
      const narrowed = users()
        .where({ role: "member" })
        .order({ id: "desc" })
        .limit(1)
        .select("email");

      const kept = await narrowed.only("where", "order").toArray();

      expect(kept.map((user) => user.id)).toEqual([3, 2]);
      expect(kept.map((user) => user.age)).toEqual([30, 40]);
    });

    test("refuses a part it doesn't know", () => {
      // @ts-expect-error -- not a part of a query
      expect(() => users().only("where", "group")).toThrow(TypeError);
    });
  });

  describe("merge", () => {
    test("carries an unscope onto the Relation merged into, as Rails does", async () => {
      const all = users();
      const members = all.where({ role: "member" }).order({ id: "desc" });

      expect(await members.merge(all.unscope("where")).pluck("id")).toEqual([4, 3, 2, 1]);
      expect((await members.merge(all.unscope("order")).first())?.id).toBe(2);
      expect(
        await members.merge(all.unscope({ where: "role" }).where({ age: 30 })).pluck("id"),
      ).toEqual([3, 1]);
    });
  });

  describe("inOrderOf", () => {
    test("orders by a list of values, keeping only the records with one of them", async () => {
      const ordered = users().inOrderOf("role", ["member", "admin"]).order({ id: "desc" });

      expect(await ordered.pluck("id")).toEqual([3, 2, 1]);
    });

    test("binds its list as one value, so any length fits a statement", async () => {
      const ids = Array.from({ length: 150 }, (_, index) => 150 - index);

      expect(await users().inOrderOf("id", ids).pluck("id")).toEqual([4, 3, 2, 1]);
      expect(users().inOrderOf("id", ids).toSql().params).toHaveLength(2);
    });

    test("places a NULL where the list has it", async () => {
      expect(await users().inOrderOf("role", [null, "admin"]).pluck("id")).toEqual([4, 1]);
    });

    test("with filter: false keeps the records not in the list, after those in it", async () => {
      const ordered = users().inOrderOf("role", ["admin"], { filter: false }).order({ id: "asc" });

      expect(await ordered.pluck("id")).toEqual([1, 2, 3, 4]);
      expect(
        await users()
          .inOrderOf("age", [50, 30], { filter: false })
          .order({ id: "asc" })
          .pluck("id"),
      ).toEqual([4, 1, 3, 2]);
    });

    test("is reversed by last(), the records not in the list first", async () => {
      const ordered = users().inOrderOf("age", [40, 50], { filter: false }).order({ id: "asc" });

      expect((await ordered.last())?.id).toBe(3);
      expect((await ordered.limit(4).last())?.id).toBe(3);
    });

    test("gives or() a different order for a different list", () => {
      const all = users();
      const admins = all.inOrderOf("role", ["admin"], { filter: false });

      expect(() => admins.or(all.inOrderOf("role", ["member"], { filter: false }))).toThrow(
        IncompatibleRelation,
      );
      expect(() => admins.or(all.inOrderOf("role", ["admin"], { filter: false }))).not.toThrow();
    });

    test("orders the groups of a grouped Relation", async () => {
      const counts = await users().inOrderOf("role", ["member", "admin"]).group("role").count();

      expect([...counts.keys()]).toEqual(["member", "admin"]);
    });

    test("keeps ordering the groups when group() drops an ungrouped order after it", async () => {
      const ordered = users().inOrderOf("role", ["member", "admin"]).order({ id: "asc" });

      expect([...(await ordered.group("role").count()).keys()]).toEqual(["member", "admin"]);
    });

    test("refuses distinct(), as Postgres can't sort distinct rows by an expression", () => {
      expect(() => users().inOrderOf("role", ["admin"]).distinct()).toThrow(IncompatibleRelation);
      expect(() => users().distinct().inOrderOf("role", ["admin"])).toThrow(IncompatibleRelation);
    });

    test("refuses a value that isn't a list, an undefined value and a json attribute", () => {
      // @ts-expect-error -- a list of values
      expect(() => users().inOrderOf("role", "admin")).toThrow(TypeError);
      // @ts-expect-error -- undefined isn't a role
      expect(() => users().inOrderOf("role", [undefined])).toThrow(TypeError);
    });
  });

  describe("excluding", () => {
    test("leaves those records out", async () => {
      const all = users();
      const [first, second] = await all.order({ id: "asc" }).limit(2).toArray();

      expect(await all.excluding(first!, second!).order({ id: "asc" }).pluck("id")).toEqual([3, 4]);
      expect(await all.excluding([first!]).order({ id: "asc" }).pluck("id")).toEqual([2, 3, 4]);
    });

    test("leaves nothing out for an unsaved record, or none", async () => {
      const all = users();

      expect(await all.excluding(all.build({ email: "new@example.com" })).count()).toBe(4);
      expect(await all.excluding().count()).toBe(4);
      expect(await all.excluding([]).count()).toBe(4);
    });

    test("refuses a record of another Model", async () => {
      const db = harness.connect();
      const post = await db.model(Post).findByOrThrow({ id: 10 });

      // @ts-expect-error -- a Post isn't a User
      expect(() => db.model(User).excluding(post)).toThrow(TypeError);
    });
  });

  describe("hasMoreThanOne and hasExactlyOne", () => {
    test("say whether more than one record matches, or exactly one, in one query", async () => {
      const events: QueryEvent[] = [];
      const all = harness.connect({ onQuery: (event) => events.push(event) }).model(User);

      expect(await all.where({ role: "member" }).hasMoreThanOne()).toBe(true);
      expect(await all.where({ role: "admin" }).hasMoreThanOne()).toBe(false);
      expect(await all.where({ role: "member" }).hasExactlyOne()).toBe(false);
      expect(await all.where({ role: "admin" }).hasExactlyOne()).toBe(true);
      expect(await all.where({ role: "guest" }).hasExactlyOne()).toBe(false);
      expect(events).toHaveLength(5);
    });

    test("answer from a loaded association's records, built ones included, with no query", async () => {
      const events: QueryEvent[] = [];
      const db = harness.connect({ onQuery: (event) => events.push(event) });
      const user = await db.model(User).includes("posts").findByOrThrow({ id: 1 });
      events.length = 0;

      expect(await user.posts().hasExactlyOne()).toBe(true);
      user.posts().build({ title: "Draft" });
      expect(await user.posts().hasMoreThanOne()).toBe(true);
      expect(events).toEqual([]);
    });

    test("count within a limit, and none() has neither, with no query", async () => {
      const events: QueryEvent[] = [];
      const all = harness.connect({ onQuery: (event) => events.push(event) }).model(User);

      expect(await all.limit(1).hasMoreThanOne()).toBe(false);
      events.length = 0;
      expect(await all.none().hasExactlyOne()).toBe(false);
      expect(await all.none().hasMoreThanOne()).toBe(false);
      expect(events).toEqual([]);
    });
  });
});
