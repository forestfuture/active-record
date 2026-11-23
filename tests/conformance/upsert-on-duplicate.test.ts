import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  column,
  incoming,
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
}) {
  static table = "users";

  static {
    this.normalizes("role", { with: (role) => role.trim().toLowerCase() });
  }
}

class Aliased extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  age: "integer",
  years: { aliasOf: "age" },
}) {
  static table = "users";
}

class Account extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  role: { type: "string", readonly: true },
  age: "integer",
  createdAt: "datetime",
}) {
  static table = "users";
}

describe("an upsert's onDuplicate (#531)", () => {
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

  test("sets a clashing row's attributes to its expressions, and inserts a new row whole", async () => {
    const result = await users().upsertAll(
      [
        { id: 1, email: "a@example.com", role: "admin", age: 5 },
        { id: 2, email: "b@example.com", role: "admin", age: 40 },
      ],
      { onDuplicate: { age: sql`${column("age")} + ${incoming("age")}` } },
    );

    expect(result.rowsAffected).toBe(2);
    expect(await stored()).toEqual([
      { id: 1, email: "a@example.com", role: "member", age: 35 },
      { id: 2, email: "b@example.com", role: "admin", age: 40 },
    ]);
  });

  test("sets a clashing row's attribute to a value, cast and normalized as an assigned value is", async () => {
    await harness
      .connect()
      .model(Member)
      .upsertAll(
        [
          { id: 1, email: "a@example.com", role: "admin", age: 5 },
          { id: 2, email: "b@example.com", role: "admin", age: 40 },
        ],
        { onDuplicate: { role: " Owner ", age: "31" as unknown as number } },
      );

    expect(await stored()).toEqual([
      { id: 1, email: "a@example.com", role: "owner", age: 31 },
      { id: 2, email: "b@example.com", role: "admin", age: 40 },
    ]);
  });

  test("binds a fragment's values, compared again for updatedAt", async () => {
    await users().upsert(
      { id: 1, email: "a@example.com" },
      { onDuplicate: { age: sql`${column("age")} + ${10}`, role: sql`${"lead"}` } },
    );

    expect(await stored()).toEqual([{ id: 1, email: "a@example.com", role: "lead", age: 40 }]);
  });

  test("returns each row as stored", async () => {
    const { rows } = await users().upsertAll(
      [
        { id: 1, email: "a@example.com", age: 5 },
        { id: 2, email: "b@example.com", age: 40 },
      ],
      {
        onDuplicate: { age: sql`${column("age")} + ${incoming("age")}` },
        returning: ["id", "age"],
      },
    );

    expect(rows).toHaveLength(2);
    expect(rows).toEqual(
      expect.arrayContaining([
        { id: 1, age: 35 },
        { id: 2, age: 40 },
      ]),
    );
  });

  test("applies in a batch", async () => {
    const db = harness.connect();

    await db.batch((b) => [
      b.upsertAll(User, [{ id: 1, email: "a@example.com", age: 5 }], {
        onDuplicate: { age: sql`${column("age")} + ${incoming("age")}` },
      }),
    ]);

    expect(await stored()).toEqual([{ id: 1, email: "a@example.com", role: "member", age: 35 }]);
  });

  test("resolves an alias to the attribute it names", async () => {
    await harness
      .connect()
      .model(Aliased)
      .upsert(
        { id: 1, email: "a@example.com", years: 5 },
        { onDuplicate: { years: sql`${column("years")} + ${incoming("years")}` } },
      );

    expect(await stored()).toEqual([{ id: 1, email: "a@example.com", role: "member", age: 35 }]);
  });

  describe("refuses", () => {
    const row = { id: 1, email: "a@example.com", age: 5, createdAt: new Date() };
    const accounts = () => harness.connect().model(Account);
    const refused = (onDuplicate: unknown, uniqueBy?: "email") =>
      expect(accounts().upsert(row, { onDuplicate: onDuplicate as never, uniqueBy }));

    test("an attribute the Model doesn't have, as a key or in a fragment", async () => {
      await refused({ nope: 1 }).rejects.toThrow(UnknownAttribute);
      await refused({ age: sql`${column("nope")} + 1` }).rejects.toThrow(UnknownAttribute);
      await refused({ age: sql`${incoming("nope")} + 1` }).rejects.toThrow(UnknownAttribute);
    });

    test("an attribute the upsert matches on", async () => {
      await refused({ email: "b@example.com" }, "email").rejects.toThrow(
        new TypeError("upsert() onDuplicate can't name email, which uniqueBy matches on"),
      );
      await refused({ id: 2 }).rejects.toThrow(
        new TypeError("upsert() onDuplicate can't name id, which uniqueBy matches on"),
      );
    });

    test("createdAt", async () => {
      await refused({ createdAt: new Date() }).rejects.toThrow(
        new TypeError("upsert() onDuplicate can't name createdAt, which an update keeps"),
      );
    });

    test("a read-only attribute", async () => {
      await refused({ role: "admin" }).rejects.toThrow(
        new TypeError("upsert() onDuplicate can't name role, which is read-only"),
      );
    });

    test("no attributes, pointing to skipping instead", async () => {
      await refused({}).rejects.toThrow(
        new TypeError(
          'upsert() onDuplicate names no attributes; to leave a clashing row as it is, use insert(row, { onDuplicate: "skip" })',
        ),
      );
    });

    test("an object that isn't one of attributes", async () => {
      await refused(sql`age = 1`).rejects.toThrow(
        new TypeError(
          "upsert() onDuplicate takes an object of attributes, each an sql`…` fragment or a value",
        ),
      );
    });

    test("together with updateOnly", async () => {
      await expect(
        accounts().upsert(row, { onDuplicate: { age: 1 }, updateOnly: ["age"] }),
      ).rejects.toThrow(new TypeError("upsert() takes updateOnly or onDuplicate, not both"));
    });

    test("in a batch, before anything is sent", async () => {
      const db = harness.connect();

      await expect(
        db.batch((b) => [
          b.upsertAll(User, [{ id: 1, email: "a@example.com" }], { onDuplicate: {} }),
        ]),
      ).rejects.toThrow(TypeError);
    });
  });

  describe("refuses incoming() outside onDuplicate", () => {
    test("in a condition", async () => {
      await expect(
        users()
          .where(sql`${incoming("age")} > 1`)
          .toArray(),
      ).rejects.toThrow(
        new TypeError(
          'incoming("age") names the value of a row an upsert writes, so only an upsert\'s onDuplicate can use it',
        ),
      );
    });

    test("in updateAll", async () => {
      await expect(users().updateAll(sql`age = ${incoming("age")}`)).rejects.toThrow(TypeError);
    });
  });
});

describe("an upsert's updatedAt with onDuplicate (#531)", () => {
  let harness: Harness;
  const users = () => harness.connect().model(User);
  const updatedAt = async () => (await users().find(1)).updatedAt;
  const past = new Date("2020-01-01T00:00:00.000Z");
  const row = { id: 1, email: "a@example.com", age: 5 };

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.reset("users");
    await users().insert({ id: 1, email: "a@example.com", age: 30, updatedAt: past });
  });

  test("is set when an expression changes a value", async () => {
    const before = Date.now();

    await users().upsert(row, { onDuplicate: { age: sql`${column("age")} + ${incoming("age")}` } });

    expect((await updatedAt())!.getTime()).toBeGreaterThanOrEqual(before - 1000);
  });

  test("is kept when an expression or a value leaves every value as it was", async () => {
    await users().upsert(row, { onDuplicate: { age: sql`${column("age")} + 0`, role: null } });

    expect(await updatedAt()).toEqual(past);
  });

  test("is set as onDuplicate says when it names updatedAt", async () => {
    const later = new Date("2021-01-01T00:00:00.000Z");

    await users().upsert(row, { onDuplicate: { age: 30, updatedAt: later } });

    expect(await updatedAt()).toEqual(later);
  });
});
