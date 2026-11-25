import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { Model } from "../../packages/arbor/src/index.ts";
import { openHarness, type Harness } from "../support/harness.ts";

class User extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  role: "string",
  age: "integer",
}) {
  static table = "users";
}

class Member extends Model.define({
  id: { type: "integer", null: false },
  key: { aliasOf: "id" },
  email: { type: "string", null: false },
  role: "string",
}) {
  static table = "users";
}

describe("an upsert matching on another index keeps a clashing row's primary key (#533)", () => {
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

  test("updates the other attributes it gives, and returns the row's own primary key", async () => {
    const { rows } = await users().upsert(
      { id: 99, email: "a@example.com", role: "admin", age: 31 },
      { uniqueBy: "email" },
    );

    expect(rows).toEqual([{ id: 1 }]);
    expect(await stored()).toEqual([{ id: 1, email: "a@example.com", role: "admin", age: 31 }]);
  });
});

describe("an upsert matching on another index refuses to update the primary key (#533)", () => {
  let harness: Harness;
  const users = () => harness.connect().model(Member);
  const row = { id: 1, email: "a@example.com", role: "admin" };

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());

  test("named in updateOnly, or by an alias", async () => {
    for (const updateOnly of ["id", "key"] as const) {
      await expect(users().upsert(row, { uniqueBy: "email", updateOnly })).rejects.toThrow(
        new TypeError(`upsert() updateOnly can't name ${updateOnly}, which is the primary key`),
      );
    }
  });

  test("named in onDuplicate", async () => {
    await expect(
      users().upsertAll([row], { uniqueBy: "email", onDuplicate: { id: 2 } }),
    ).rejects.toThrow(
      new TypeError("upsertAll() onDuplicate can't name id, which is the primary key"),
    );
  });
});
