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
