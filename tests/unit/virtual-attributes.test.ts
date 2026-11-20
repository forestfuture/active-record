/* oxlint-disable typescript/no-unsafe-declaration-merging -- each interface stands in for the
   declarations active-record schema generates, which merge from another file: the accessors they
   type are defined when the Model's attributes resolve. */
// Virtual attributes (#356): declared in `static attributes` with `virtual: true`, cast and
// tracked like a column's, never a column. These tests need no database.
import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import {
  InvalidModel,
  Model,
  type TableAttributes,
} from "../../packages/active-record/src/index.ts";
import { d1, connect } from "../../packages/active-record/src/adapters/d1/index.ts";

const db = connect({} as never);

/** What a Model's `static attributes` may hold. */
type Overrides = NonNullable<(typeof Model)["attributes"]>;

const users = {
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
} as const;

const schema = {
  adapter: d1({ binding: "DB" }),
  tables: { users: { attributes: users, primaryKey: "id" } },
  models: { User: "users", Clashing: "users", Unset: "users", Listed: "users" },
} as const;

abstract class AppRecord extends Model {
  static override schema = schema;
}

class User extends AppRecord {
  static override attributes = {
    termsOfService: { type: "boolean", virtual: true },
  } as const;
}
interface User extends TableAttributes<typeof users, (typeof User)["attributes"]> {}

describe("a virtual attribute", () => {
  test("is typed as its type, nullable", () => {
    expectTypeOf<User["termsOfService"]>().toEqualTypeOf<boolean | null>();
  });

  test("is cast as its type from a form's fields", () => {
    const form = { email: "jane@example.com", termsOfService: "1" };
    const user = db.model(User).build(User.permit(form, "email", "termsOfService"));
    expect(user.termsOfService).toBe(true);
  });

  test("reads as null until assigned", () => {
    expect(db.model(User).build({ email: "jane@example.com" }).termsOfService).toBeNull();
  });
});

describe("declaring a virtual attribute", () => {
  test("with a column's name is an InvalidModel", () => {
    class Clashing extends AppRecord {
      static override table = "users";
      static override attributes = { email: { type: "string", virtual: true } } as const;
    }
    expect(() => db.model(Clashing)).toThrow(
      new InvalidModel(
        "Clashing.email is virtual, but Clashing's table has a column for it; rename it, or drop virtual",
      ),
    );
  });

  test("non-null without a default is an InvalidModel", () => {
    class Unset extends AppRecord {
      static override table = "users";
      static override attributes = {
        agreed: { type: "boolean", virtual: true, null: false },
      } as const;
    }
    expect(() => db.model(Unset)).toThrow(
      new InvalidModel("Unset.agreed is virtual and null: false, so it needs a default"),
    );
  });

  test("with an enum is a compile error, and an InvalidModel", () => {
    const listed = {
      // @ts-expect-error -- an enum's values are stored, and a virtual attribute isn't
      plan: { type: "string", virtual: true, enum: ["free", "paid"] },
    } as const satisfies Overrides;
    class Listed extends AppRecord {
      static override table = "users";
      static override attributes: Overrides = listed as never;
    }
    expect(() => db.model(Listed)).toThrow(
      new InvalidModel("Listed.plan has both virtual and an enum; keep one"),
    );
  });
});
