// Declaring a secure password (#355): `password: { securePassword: true }`, its attributes and
// methods typed, and a declaration that can't work refused. These tests need no database.
import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import { InvalidModel, Model } from "../../packages/active-record/src/index.ts";
import { connect } from "../../packages/active-record/src/adapters/d1/index.ts";

const db = connect({} as never);

class Member extends Model.define({
  id: { type: "integer", null: false },
  email: "string",
  passwordDigest: "string",
  password: { securePassword: true },
}) {
  static table = "members";
}

describe("a secure password's declaration", () => {
  test("adds the password, its confirmation and its challenge, as strings", () => {
    const member = db.model(Member).build({ password: "secret", passwordConfirmation: "secret" });

    expectTypeOf(member.password).toEqualTypeOf<string | null>();
    expectTypeOf(member.passwordConfirmation).toEqualTypeOf<string | null>();
    expectTypeOf(member.passwordChallenge).toEqualTypeOf<string | null>();
    expect(member.password).toBe("secret");
    expect(member.passwordChallenge).toBe(null);
  });

  test("gives authenticate to password alone, and authenticate…() to each", () => {
    class Staff extends Model.define({
      recoveryPasswordDigest: "string",
      recoveryPassword: { securePassword: true },
    }) {}

    expectTypeOf<Staff>().toHaveProperty("authenticateRecoveryPassword");
    expectTypeOf<Staff>().not.toHaveProperty("authenticate");
    expectTypeOf<Member>().toHaveProperty("authenticate");
    expect(typeof Staff.prototype.authenticateRecoveryPassword).toBe("function");
    expect("authenticate" in Staff.prototype).toBe(false);
  });

  test("gives a Model authenticateBy only with a secure password", () => {
    class Visitor extends Model.define({ id: { type: "integer", null: false }, email: "string" }) {
      static table = "visitors";
    }

    // @ts-expect-error -- a Model without a secure password has nothing to authenticate
    void (() => Visitor.authenticateBy({ email: "jane@example.com" }));
    expectTypeOf(Member.authenticateBy).parameter(0).toHaveProperty("password");
  });

  test("needs a string attribute for its digest", () => {
    expect(() =>
      Model.define({
        id: { type: "integer", null: false },
        password: { securePassword: true },
      }),
    ).toThrow(
      new InvalidModel(
        "password is a secure password, so it needs a string attribute passwordDigest with a column to keep its digest in",
      ),
    );
  });

  test("refuses a digest that isn't a column", () => {
    expect(() =>
      Model.define({
        id: { type: "integer", null: false },
        passwordDigest: { type: "string", virtual: true },
        password: { securePassword: true },
      }),
    ).toThrow(InvalidModel);
  });

  test("refuses another key", () => {
    expect(() =>
      Model.define({
        passwordDigest: "string",
        // @ts-expect-error -- a secure password takes no other key
        password: { securePassword: true, null: false },
      }),
    ).toThrow(
      new InvalidModel(
        "password: a secure password is { securePassword: true }, or { securePassword: { algorithm?, validations? } }",
      ),
    );
  });

  test("refuses a confirmation declared alongside it", () => {
    expect(() =>
      Model.define({
        passwordDigest: "string",
        passwordConfirmation: { type: "string", virtual: true },
        password: { securePassword: true },
      }),
    ).toThrow(
      new InvalidModel(
        "passwordConfirmation is declared by the secure password password, so leave it out",
      ),
    );
  });

  test("refuses options it doesn't know", () => {
    expect(() =>
      Model.define({
        passwordDigest: "string",
        // @ts-expect-error -- securePassword takes an algorithm and validations
        password: { securePassword: { validate: false } },
      }),
    ).toThrow(InvalidModel);
  });
});
