import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { Model } from "../../packages/active-record/src/index.ts";
import { openHarness, type Harness } from "../support/harness.ts";

class User extends Model.define({
  id: { type: "integer", null: false },
  email: "string",
  role: "string",
}) {
  static table = "users";

  static {
    this.validates("role", { presence: true, on: "create" });
  }
}

let harness: Harness;

beforeAll(async () => {
  harness = await openHarness();
});
afterAll(() => harness.dispose());
beforeEach(() => harness.reset("posts", "users"));

describe("on", () => {
  test('on: "create" runs the rules only while the record is new', async () => {
    const users = harness.connect().model(User);

    const user = users.build({ email: "a@example.com" });
    expect(await user.isValid()).toBe(false);
    expect(user.errors.get("role")).toEqual(["can't be blank"]);
    expect(await user.save()).toBe(false);

    await harness.exec("INSERT INTO users (id, email) VALUES (1, ?)", ["b@example.com"]);
    const saved = await users.find(1);
    expect(await saved.isValid()).toBe(true);
    expect(await saved.save()).toBe(true);
  });
});
