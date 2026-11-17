import { describe, expectTypeOf, test } from "vite-plus/test";
import { gt, Model } from "../../packages/active-record/src/index.ts";

class User extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  age: "integer",
}) {
  static table = "users";
}

class Admin extends User {
  level = 1;
}

describe("finding or making a record, typed", () => {
  test("each static resolves to, and hands init, a record of the class it's called on", () => {
    // Type-checked, never run: these would query.
    const typed = () => {
      expectTypeOf(Admin.findOrCreateBy({ email: "a" })).toEqualTypeOf<Promise<Admin>>();
      expectTypeOf(Admin.findOrCreateByOrThrow({ email: "a" })).toEqualTypeOf<Promise<Admin>>();
      expectTypeOf(Admin.findOrInitializeBy({ email: "a" })).toEqualTypeOf<Promise<Admin>>();
      expectTypeOf(Admin.createOrFindBy({ email: "a" })).toEqualTypeOf<Promise<Admin>>();
      expectTypeOf(Admin.createOrFindByOrThrow({ email: "a" })).toEqualTypeOf<Promise<Admin>>();
      void Admin.createOrFindBy({ email: "a" }, (admin) => {
        expectTypeOf(admin).toEqualTypeOf<Admin>();
      });
      expectTypeOf(Admin.build({}, (admin) => void admin.level)).toEqualTypeOf<Admin>();
      expectTypeOf(Admin.createWith({ age: 1 }).build()).toEqualTypeOf<Admin>();
    };
    void typed;
  });

  test("the attributes are values a new record can have, not conditions", () => {
    const typed = () => {
      // @ts-expect-error -- a list of values can't be a new record's value
      void User.findOrCreateBy({ age: [1, 2] });
      // @ts-expect-error -- nor can a comparison
      void User.createOrFindBy({ age: gt(1) });
      // @ts-expect-error -- an attribute's value is its type's
      void User.createWith({ age: "old" });
      // @ts-expect-error -- build's init isn't awaited, so it can't be async
      void User.build({}, async () => {});
    };
    void typed;
  });
});
