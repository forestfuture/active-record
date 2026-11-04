import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { column, IncompatibleRelation, IrreversibleOrder, Model, sql } from "../../src/index.ts";
import { openHarness, type Harness } from "../support/harness.ts";

class User extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  role: "string",
}) {
  static table = "users";

  static byEmail = this.scope((q) => q.order({ email: "asc" }));
}

describe("ordering extras", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await openHarness();
    await harness.exec(`INSERT INTO users (id, email, role) VALUES
           (1, 'b@example.com', 'member'),
           (2, 'C@example.com', NULL),
           (3, 'a@example.com', 'admin'),
           (4, 'D@example.com', NULL)`);
  });
  afterAll(() => harness.dispose());

  test("reorder replaces the order so far, and reorder() removes it", async () => {
    const users = harness.connect().model(User);

    expect(await users.byEmail().reorder({ id: "desc" }).pluck("id")).toEqual([4, 3, 2, 1]);
    expect(await users.order({ id: "desc" }).reorder().limit(1).pluck("id")).toHaveLength(1);
    expect(await users.order({ id: "desc" }).reorder().first()).toMatchObject({ id: 1 });
  });

  test("merging a reorder() replaces the order, even with nothing, as in Rails", async () => {
    const users = harness.connect().model(User);

    expect(await users.order({ id: "desc" }).merge(users.reorder()).first()).toMatchObject({
      id: 1,
    });
    expect(
      await users
        .order({ id: "desc" })
        .merge(users.reorder({ email: "asc" }))
        .pluck("id"),
    ).toEqual([2, 4, 3, 1]);
  });

  test("order takes an sql fragment for expressions, and appends like any order", async () => {
    const users = harness.connect().model(User);

    const byLowerEmail = users.order(sql`lower(${column("email")})`);
    const adminsFirst = users.order(sql`${column("role")} = ${"admin"} DESC`).order({ id: "asc" });

    expect(await byLowerEmail.pluck("id")).toEqual([3, 1, 2, 4]);
    expect(await adminsFirst.pluck("id")).toEqual([3, 1, 2, 4]);
  });

  test("a fragment order's values bind in place, alongside where and limit values, in count too", async () => {
    const users = harness
      .connect()
      .model(User)
      .where({ id: [1, 2, 3, 4] })
      .order(sql`${column("role")} = ${"member"} DESC`)
      .order({ id: "asc" })
      .limit(2);

    expect(await users.pluck("id")).toEqual([1, 3]);
    expect(await users.count()).toBe(2);
  });

  test("nulls: first or last places NULLs regardless of direction", async () => {
    const users = harness.connect().model(User);

    const nullsLast = users.order({ role: { direction: "asc", nulls: "last" }, id: "asc" });
    const nullsFirst = users.order({ role: { direction: "desc", nulls: "first" }, id: "asc" });

    expect(await nullsLast.pluck("id")).toEqual([3, 1, 2, 4]);
    expect(await nullsFirst.pluck("id")).toEqual([2, 4, 1, 3]);
  });

  test("last() reverses nulls too, as Rails' reverse_order does", async () => {
    const users = harness.connect().model(User);

    const nullsLast = users.order({ role: { direction: "asc", nulls: "last" }, id: "asc" });

    expect(await nullsLast.last()).toMatchObject({ id: 4 });
  });

  test("last() can't reverse an sql fragment, so it throws IrreversibleOrder", async () => {
    const users = harness
      .connect()
      .model(User)
      .order(sql`lower(${column("email")})`);

    await expect(users.last()).rejects.toThrow(IrreversibleOrder);
  });

  test("or() needs the same order, fragments included", async () => {
    const users = harness.connect().model(User);
    const byLower = () => sql`lower(${column("email")})`;

    const same = users
      .where({ id: 1 })
      .order(byLower())
      .or(users.where({ id: 3 }).order(byLower()));

    expect(await same.pluck("id")).toEqual([3, 1]);
    const byCutoff = () => sql`${column("id")} > ${new Date(Date.UTC(2026, 0, 1))}`;
    expect(() =>
      users
        .where({ id: 1 })
        .order(byCutoff())
        .or(users.where({ id: 3 }).order(byCutoff())),
    ).not.toThrow();
    expect(() =>
      users.order(sql`lower(${column("email")})`).or(users.order(sql`upper(${column("email")})`)),
    ).toThrow(IncompatibleRelation);
  });

  test("nulls must be first or last, and a plain string isn't an order", () => {
    const users = harness.connect().model(User);

    expect(() => users.order({ role: { direction: "asc", nulls: "middle" as never } })).toThrow(
      TypeError,
    );
    expect(() => users.order("email" as never)).toThrow(TypeError);
    expect(() => users.reorder("email" as never)).toThrow(TypeError);
  });
});
