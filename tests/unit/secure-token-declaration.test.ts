// Declaring a secure token (#355): `authToken: { secureToken: true }` on a string, its methods
// typed, a declaration that can't work refused, and `generateSecureToken`. No database.
import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import {
  generateSecureToken,
  InvalidModel,
  Model,
} from "../../packages/active-record/src/index.ts";
import { connect } from "../../packages/active-record/src/adapters/d1/index.ts";

const db = connect({} as never);

describe("a secure token's declaration", () => {
  test("gives a record regenerate…() and its OrThrow", () => {
    class Member extends Model.define({
      id: { type: "integer", null: false },
      authToken: { type: "string", secureToken: true },
    }) {
      static table = "members";
    }

    const member = db.model(Member).build();

    expectTypeOf(member.regenerateAuthToken).toEqualTypeOf<() => Promise<boolean>>();
    expectTypeOf(member.regenerateAuthTokenOrThrow).toEqualTypeOf<() => Promise<true>>();
    expect(member.authToken).toHaveLength(24);
  });

  test("gives regenerate…() only to a secure token", () => {
    class Visitor extends Model.define({
      id: { type: "integer", null: false },
      authToken: "string",
    }) {
      static table = "visitors";
    }

    expectTypeOf<Visitor>().not.toHaveProperty("regenerateAuthToken");
    expect("regenerateAuthToken" in Visitor.prototype).toBe(false);
  });

  test("refuses a length under 24", () => {
    class Member extends Model.define({
      id: { type: "integer", null: false },
      authToken: { type: "string", secureToken: { length: 12 } },
    }) {
      static table = "members";
    }

    expect(() => db.model(Member)).toThrow(
      new InvalidModel(
        "Member.authToken has a secureToken of length 12; a secure token is at least 24 characters",
      ),
    );
  });

  test("refuses an attribute that isn't a string", () => {
    class Member extends Model.define({
      id: { type: "integer", null: false },
      // @ts-expect-error -- only a string has a secure token
      pin: { type: "integer", secureToken: true },
    }) {
      static table = "members";
    }

    expect(() => db.model(Member)).toThrow(
      new InvalidModel(
        'Member.pin is "integer", so it can\'t have secureToken: a token is a string',
      ),
    );
  });

  test("refuses a default with it", () => {
    class Member extends Model.define({
      id: { type: "integer", null: false },
      authToken: { type: "string", secureToken: true, default: () => "fixed" },
    }) {
      static table = "members";
    }

    expect(() => db.model(Member)).toThrow(
      new InvalidModel("Member.authToken has both secureToken and a default; keep one"),
    );
  });

  test("refuses an option it doesn't know", () => {
    class Member extends Model.define({
      id: { type: "integer", null: false },
      // @ts-expect-error -- `on` is "initialize" or "create"
      authToken: { type: "string", secureToken: { on: "save" } },
    }) {
      static table = "members";
    }

    expect(() => db.model(Member)).toThrow(InvalidModel);
  });
});

describe("generateSecureToken", () => {
  test("makes 24 characters of base58, or as many as asked", () => {
    expect(generateSecureToken()).toMatch(/^[1-9A-HJ-NP-Za-km-z]{24}$/);
    expect(generateSecureToken(64)).toMatch(/^[1-9A-HJ-NP-Za-km-z]{64}$/);
  });

  test("uses every character of the alphabet", () => {
    const characters = new Set(generateSecureToken(5000));

    expect(characters.size).toBe(58);
  });

  test("refuses a length that isn't a whole number of characters", () => {
    expect(() => generateSecureToken(0)).toThrow(RangeError);
    expect(() => generateSecureToken(2.5)).toThrow(RangeError);
  });
});
