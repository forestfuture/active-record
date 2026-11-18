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
});
