/* oxlint-disable typescript/no-unsafe-declaration-merging -- each interface stands in for the
   declarations active-record schema generates, which merge from another file: the accessors they
   type are defined when the Model's attributes resolve. */
// Attribute aliases (#509): declared in `static attributes` with `aliasOf`, typed as the attribute
// they name. These tests need no database.
import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import {
  InvalidModel,
  Model,
  UnknownAttribute,
  type TableAttributes,
} from "../../packages/active-record/src/index.ts";
import { connect, d1 } from "../../packages/active-record/src/adapters/d1/index.ts";

const db = connect({} as never);

/** What a Model's `static attributes` may hold. */
type Overrides = NonNullable<(typeof Model)["attributes"]>;

const users = {
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  age: "integer",
} as const;

const schema = {
  adapter: d1({ binding: "DB" }),
  tables: { users: { attributes: users, primaryKey: "id" } },
  models: { User: "users", Declared: "users" },
} as const;

abstract class AppRecord extends Model {
  static override schema = schema;
}

class User extends AppRecord {
  static override attributes = {
    login: { aliasOf: "email" },
    years: { aliasOf: "age" },
  } as const;
}
interface User extends TableAttributes<typeof users, (typeof User)["attributes"]> {}

describe("an attribute alias", () => {
  test("is typed as the attribute it names", () => {
    expectTypeOf<User["login"]>().toEqualTypeOf<string>();
    expectTypeOf<User["years"]>().toEqualTypeOf<number | null>();
  });
});

/** A Model on the users table declaring `attributes`, as plain JavaScript might. */
function declaring(attributes: Overrides) {
  return class Declared extends AppRecord {
    static override table = "users";
    static override attributes = attributes;
  };
}

describe("declaring an alias", () => {
  test("of a name that isn't an attribute is an InvalidModel", () => {
    expect(() => db.model(declaring({ login: { aliasOf: "mail" } }))).toThrow(
      new InvalidModel("Declared.login is an alias of mail, which isn't an attribute"),
    );
  });

  test("of an alias is an InvalidModel naming the attribute", () => {
    const attributes = { login: { aliasOf: "email" }, handle: { aliasOf: "login" } };

    expect(() => db.model(declaring(attributes))).toThrow(
      new InvalidModel("Declared.handle is an alias of login, an alias itself; name email"),
    );
  });

  test("named for one of the table's attributes is an InvalidModel", () => {
    expect(() => db.model(declaring({ age: { aliasOf: "email" } }))).toThrow(
      new InvalidModel("Declared.age is an attribute already, so it can't be an alias"),
    );
  });

  test("with another key is an InvalidModel", () => {
    expect(() => db.model(declaring({ login: { aliasOf: "email", null: true } as never }))).toThrow(
      new InvalidModel('Declared.login: an alias is { aliasOf: "attribute" }, and nothing else'),
    );
  });

  test("of a virtual attribute is refused in a query, as the attribute is", () => {
    const Declared = declaring({
      nickname: { type: "string", virtual: true },
      alias: { aliasOf: "nickname" },
    });

    expect(() => db.model(Declared).where({ alias: "Janie" } as never)).toThrow(UnknownAttribute);
  });
});

describe("declaring an alias with define", () => {
  test("of a name that isn't an attribute is an InvalidModel", () => {
    expect(
      () =>
        class Visitor extends Model.define({
          id: "integer",
          login: { aliasOf: "mail" },
        }) {},
    ).toThrow(new InvalidModel("login is an alias of mail, which isn't an attribute"));
  });
});
