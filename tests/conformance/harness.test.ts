import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { Model } from "../../packages/active-record/src/index.ts";
import { openHarness, type Harness } from "../support/harness.ts";

class Account extends Model.define({ id: { type: "integer", null: false }, email: "string" }) {
  static table = "users";
}

// Proves the harness itself: what the rest of the suite seeds and resets its tables with.
describe("the conformance harness", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());

  test("exec runs SQL with ? placeholders and resolves to its rows", async () => {
    await harness.exec("INSERT INTO users (id, email) VALUES (?, ?)", [1, "a@example.com"]);

    expect(await harness.exec("SELECT id, email FROM users WHERE id = ?", [1])).toEqual([
      { id: 1, email: "a@example.com" },
    ]);
  });

  test("reset deletes every row of the tables it names", async () => {
    await harness.exec("INSERT INTO users (id, email) VALUES (?, ?)", [2, "b@example.com"]);

    await harness.reset("users");

    expect(await harness.exec("SELECT id FROM users")).toEqual([]);
  });

  test("connect opens a Database on it", async () => {
    await harness.exec("INSERT INTO users (id, email) VALUES (?, ?)", [3, "c@example.com"]);

    const rows = await harness.connect().model(Account).pluck("email");

    expect(rows).toEqual(["c@example.com"]);
  });
});
