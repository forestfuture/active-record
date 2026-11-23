import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { Model, UnknownAttribute } from "../../packages/active-record/src/index.ts";
import { openHarness, type Harness } from "../support/harness.ts";

class User extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  role: "string",
  age: "integer",
  createdAt: "datetime",
  updatedAt: "datetime",
}) {
  static table = "users";
}

class Member extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  role: "string",
  age: "integer",
  years: { aliasOf: "age" },
}) {
  static table = "users";
}

class Account extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  role: { type: "string", readonly: true },
  age: { type: "integer", default: () => 18 },
  createdAt: "datetime",
}) {
  static table = "users";
}

describe("an upsert's updateOnly (#36)", () => {
  let harness: Harness;
  const users = () => harness.connect().model(User);
  const stored = () => harness.exec("SELECT id, email, role, age FROM users ORDER BY id");

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.reset("users");
    await harness.exec(
      "INSERT INTO users (id, email, role, age) VALUES (1, 'a@example.com', 'member', 30)",
    );
  });

  test("updates only the attributes it names on a clash, and inserts a new row whole", async () => {
    const result = await users().upsertAll(
      [
        { id: 1, email: "a@example.com", role: "admin", age: 31 },
        { id: 2, email: "b@example.com", role: "admin", age: 40 },
      ],
      { updateOnly: ["role"] },
    );

    expect(result.rowsAffected).toBe(2);
    expect(await stored()).toEqual([
      { id: 1, email: "a@example.com", role: "admin", age: 30 },
      { id: 2, email: "b@example.com", role: "admin", age: 40 },
    ]);
  });

  test("returns each row as stored: a clashing row with only the named attributes updated", async () => {
    const { rows } = await users().upsertAll(
      [
        { id: 1, email: "a@example.com", role: "admin", age: 31 },
        { id: 2, email: "b@example.com", role: "admin", age: 40 },
      ],
      { updateOnly: ["role"], returning: ["id", "role", "age"] },
    );

    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        { id: 1, role: "admin", age: 30 },
        { id: 2, role: "admin", age: 40 },
      ]),
    );
  });

  test("leaves a value the Relation adds unless it names it", async () => {
    const admins = users().where({ role: "admin" });

    await admins.upsert({ id: 1, email: "a@example.com", age: 31 }, { updateOnly: ["age"] });
    const left = await stored();
    await admins.upsert(
      { id: 1, email: "a@example.com", age: 32 },
      { updateOnly: ["role", "age"] },
    );

    expect(left).toEqual([{ id: 1, email: "a@example.com", role: "member", age: 31 }]);
    expect(await stored()).toEqual([{ id: 1, email: "a@example.com", role: "admin", age: 32 }]);
  });

  test("leaves createWith's value unless it names it", async () => {
    const admins = users().createWith({ role: "admin" });

    await admins.upsert({ id: 1, email: "a@example.com", age: 31 }, { updateOnly: "age" });
    const left = await stored();
    await admins.upsert(
      { id: 1, email: "a@example.com", age: 32 },
      { updateOnly: ["role", "age"] },
    );

    expect(left).toEqual([{ id: 1, email: "a@example.com", role: "member", age: 31 }]);
    expect(await stored()).toEqual([{ id: 1, email: "a@example.com", role: "admin", age: 32 }]);
  });

  test("takes one attribute as a string, on upsert", async () => {
    await users().upsert(
      { email: "a@example.com", role: "admin", age: 31 },
      { uniqueBy: "email", updateOnly: "age" },
    );

    expect(await stored()).toEqual([{ id: 1, email: "a@example.com", role: "member", age: 31 }]);
  });

  test("applies in a batch", async () => {
    const db = harness.connect();

    await db.batch((b) => [
      b.upsertAll(User, [{ id: 1, email: "a@example.com", role: "admin", age: 31 }], {
        updateOnly: ["age"],
      }),
    ]);

    expect(await stored()).toEqual([{ id: 1, email: "a@example.com", role: "member", age: 31 }]);
  });

  test("resolves an alias to the attribute it names", async () => {
    await harness
      .connect()
      .model(Member)
      .upsert(
        { id: 1, email: "a@example.com", role: "admin", years: 31 },
        { updateOnly: ["years"] },
      );

    expect(await stored()).toEqual([{ id: 1, email: "a@example.com", role: "member", age: 31 }]);
  });

  describe("refuses", () => {
    const row = { id: 1, email: "a@example.com", role: "admin", createdAt: new Date() };
    const accounts = () => harness.connect().model(Account);
    const refused = (updateOnly: unknown, uniqueBy?: "email") =>
      expect(accounts().upsert(row, { updateOnly: updateOnly as never, uniqueBy }));

    test("an attribute the Model doesn't have", async () => {
      await refused(["nope"]).rejects.toThrow(UnknownAttribute);
    });

    test("an attribute the rows don't give, even one a default fills in", async () => {
      await refused(["age"]).rejects.toThrow(
        new TypeError("upsert() updateOnly names age, which the rows don't give"),
      );
    });

    test("an attribute the upsert matches on", async () => {
      await refused(["email"], "email").rejects.toThrow(
        new TypeError("upsert() updateOnly can't name email, which uniqueBy matches on"),
      );
      await refused(["id"]).rejects.toThrow(
        new TypeError("upsert() updateOnly can't name id, which uniqueBy matches on"),
      );
    });

    test("createdAt", async () => {
      await refused(["createdAt"]).rejects.toThrow(
        new TypeError("upsert() updateOnly can't name createdAt, which an update keeps"),
      );
    });

    test("a read-only attribute", async () => {
      await refused(["role"]).rejects.toThrow(
        new TypeError("upsert() updateOnly can't name role, which is read-only"),
      );
    });

    test("no attributes, pointing to skipping instead", async () => {
      await refused([]).rejects.toThrow(
        new TypeError(
          'upsert() updateOnly names no attributes; to leave a clashing row as it is, use insert(row, { onDuplicate: "skip" })',
        ),
      );
    });

    test("in a batch, before anything is sent", async () => {
      const db = harness.connect();

      await expect(
        db.batch((b) => [
          b.upsertAll(User, [{ id: 1, email: "a@example.com" }], { updateOnly: ["age"] }),
        ]),
      ).rejects.toThrow(TypeError);
    });
  });
});
