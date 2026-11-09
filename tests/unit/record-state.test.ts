import { describe, expect, test } from "vite-plus/test";
import { Model, RecordDestroyed } from "../../packages/active-record/src/index.ts";
import { connect } from "../../packages/active-record/src/adapters/d1/index.ts";

class User extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  role: "string",
}) {
  static table = "users";
}

// No D1 needed: these records are only built, never loaded or written.
const users = connect({} as never).model(User);

describe("record state without D1", () => {
  test("setting an attribute to undefined throws, like assign, instead of storing NULL", () => {
    const user = users.build({ email: "a@example.com" });

    expect(() => {
      user.role = undefined as never;
    }).toThrow(TypeError);
    expect(() => {
      user.role = undefined as never;
    }).toThrow(/"role".*null/);
    expect(user.role).toBeNull();
  });

  test("a destroyed record is read-only: setting or assigning throws, reading still works", async () => {
    const user = users.build({ email: "a@example.com" });
    await user.destroy(); // never saved, so no D1 statement

    expect(() => {
      user.role = "admin";
    }).toThrow(RecordDestroyed);
    expect(() => user.assign({ role: "admin" })).toThrow(RecordDestroyed);
    expect(user.email).toBe("a@example.com");
    expect(user.role).toBeNull();
  });

  test("a built record's changes are its assigned attributes, each changed from null", () => {
    const user = users.build({ email: "a@example.com" });
    user.role = "admin";

    expect(user.changed()).toEqual(["email", "role"]);
    expect(user.changes()).toEqual({ email: [null, "a@example.com"], role: [null, "admin"] });
    expect(user.changedAttributes()).toEqual({ email: null, role: null });
  });

  test("a default that returns undefined is rejected when the record is built", () => {
    class Token extends Model.define({
      id: { type: "string", null: false, default: () => undefined },
    }) {
      static table = "tokens";
    }

    expect(() =>
      connect({} as never)
        .model(Token)
        .build(),
    ).toThrow(/Token.*"id".*null/);
  });
});
