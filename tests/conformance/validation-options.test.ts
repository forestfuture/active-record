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
    this.validates("email", { presence: true, unless: (user) => user.role === "guest" });
    this.validates("role", {
      length: { minimum: 4 },
      if: (user) => user.email !== null,
      unless: (user) => user.email === "root@example.com",
    });
  }
}

let harness: Harness;

beforeAll(async () => {
  harness = await openHarness();
});
afterAll(() => harness.dispose());
beforeEach(() => harness.reset());

describe("unless", () => {
  test("skips the rules when it returns true", async () => {
    const users = harness.connect().model(User);

    expect(await users.build({ role: "guest" }).isValid()).toBe(true);
    const member = users.build({ role: "member" });
    expect(await member.isValid()).toBe(false);
    expect(member.errors.get("email")).toEqual(["can't be blank"]);
  });

  test("with if, runs the rules only when if holds and unless doesn't", async () => {
    const users = harness.connect().model(User);
    const roleErrors = async (email: string | null) => {
      const user = users.build({ email, role: "x" });
      await user.isValid();
      return user.errors.get("role");
    };

    expect(await roleErrors("a@example.com")).toEqual(["is too short (minimum is 4 characters)"]);
    expect(await roleErrors("root@example.com")).toEqual([]);
    expect(await roleErrors(null)).toEqual([]);
  });
});
