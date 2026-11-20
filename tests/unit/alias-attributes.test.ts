/* oxlint-disable typescript/no-unsafe-declaration-merging -- each interface stands in for the
   declarations active-record schema generates, which merge from another file: the accessors they
   type are defined when the Model's attributes resolve. */
// Attribute aliases (#509): declared in `static attributes` with `aliasOf`, typed as the attribute
// they name. These tests need no database.
import { describe, expectTypeOf, test } from "vite-plus/test";
import { Model, type TableAttributes } from "../../packages/active-record/src/index.ts";
import { d1 } from "../../packages/active-record/src/adapters/d1/index.ts";

const users = {
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  age: "integer",
} as const;

const schema = {
  adapter: d1({ binding: "DB" }),
  tables: { users: { attributes: users, primaryKey: "id" } },
  models: { User: "users" },
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
