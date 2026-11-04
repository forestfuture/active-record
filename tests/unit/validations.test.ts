import { describe, expect, test } from "vite-plus/test";
import { Model } from "../../packages/active-record/src/index.ts";
import { connect } from "../../packages/d1-record/src/index.ts";

class User extends Model.define({
  id: { type: "integer", null: false },
  email: "string",
  role: "string",
}) {
  static table = "users";

  static {
    this.validates("email", { presence: true });
  }
}

// No D1 needed: validation without uniqueness never queries.
const users = connect({} as never).model(User);

describe("validations", () => {
  test("isValid reports a blank attribute, and re-checks from scratch each time", async () => {
    const user = users.build({ email: "   " });

    expect(await user.isValid()).toBe(false);
    expect(user.errors.get("email")).toEqual(["can't be blank"]);

    user.email = "a@example.com";
    expect(await user.isValid()).toBe(true);
    expect(user.errors.isEmpty()).toBe(true);
  });

  test("the errors collection: add, get, fullMessages, toArray, isEmpty, size and base errors", () => {
    const { errors } = users.build();

    errors.add("createdAt", "is in the future");
    errors.add("email", "is taken", { type: "taken" });
    errors.add("base", "Account is locked");

    expect(errors.get("email")).toEqual(["is taken"]);
    expect(errors.get("role")).toEqual([]);
    expect(errors.fullMessages()).toEqual([
      "Created at is in the future",
      "Email is taken",
      "Account is locked",
    ]);
    expect(errors.toArray()[0]).toEqual({
      attribute: "createdAt",
      type: "invalid",
      message: "is in the future",
    });
    expect(errors.size).toBe(3);
    expect(errors.isEmpty()).toBe(false);
  });

  test("a subclass inherits its parent's validations, and adding more never changes the parent", async () => {
    class Admin extends User {
      static {
        this.validates("role", { presence: true });
      }
    }
    const admins = connect({} as never).model(Admin);

    const admin = admins.build();
    const user = users.build();
    await admin.isValid();
    await user.isValid();

    expect(admin.errors.toArray().map((error) => error.attribute)).toEqual(["email", "role"]);
    expect(user.errors.toArray().map((error) => error.attribute)).toEqual(["email"]);
  });

  test("only a validation run clears errors: there's no public clear()", () => {
    const { errors } = users.build();

    // @ts-expect-error clear() isn't part of the errors collection's interface
    expect(errors.clear).toBeUndefined();
  });
});
