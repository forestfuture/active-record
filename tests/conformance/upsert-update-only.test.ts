import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { Model } from "../../packages/active-record/src/index.ts";
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
});
