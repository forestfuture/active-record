import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { column, gte, Model, sql } from "../../packages/active-record/src/index.ts";
import { openHarness, type Harness } from "../support/harness.ts";

class User extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  role: "string",
  age: "integer",
}) {
  static table = "users";
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
});
