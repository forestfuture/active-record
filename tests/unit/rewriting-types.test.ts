import { describe, expectTypeOf, test } from "vite-plus/test";
import {
  Model,
  sql,
  type InOrderOfOptions,
  type QueryPart,
} from "../../packages/active-record/src/index.ts";

class User extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  role: "string",
}) {
  static table = "users";
}

class Admin extends User {
  level = 1;
}

class Post extends Model.define({ id: { type: "integer", null: false } }) {
  static table = "posts";
}

describe("rewriting queries, typed (#350)", () => {
  test("each static returns a Relation of the class it's called on", () => {
    // Type-checked, never run: these would need a database.
    const typed = () => {
      expectTypeOf(Admin.rewhere({ role: "admin" }).build()).toEqualTypeOf<Admin>();
      expectTypeOf(Admin.unscope("where", { where: "role" }).build()).toEqualTypeOf<Admin>();
      expectTypeOf(Admin.only("where").build()).toEqualTypeOf<Admin>();
      expectTypeOf(Admin.inOrderOf("role", ["admin", null]).build()).toEqualTypeOf<Admin>();
      expectTypeOf(Admin.excluding(new Admin()).build()).toEqualTypeOf<Admin>();
      expectTypeOf(Admin.hasMoreThanOne()).toEqualTypeOf<Promise<boolean>>();
      expectTypeOf(Admin.hasExactlyOne()).toEqualTypeOf<Promise<boolean>>();
    };
    void typed;
  });

  test("each takes only what it can use", () => {
    const typed = () => {
      // @ts-expect-error -- rewhere takes attribute values, not a fragment
      User.rewhere(sql`1 = 1`);
      // @ts-expect-error -- not a part of a query
      User.unscope("group");
      // @ts-expect-error -- not an attribute of User
      User.unscope({ where: "title" });
      // @ts-expect-error -- a role is a string
      User.inOrderOf("role", [1]);
      // @ts-expect-error -- a Post isn't a User
      User.excluding(new Post());
    };
    void typed;
  });

  test("an app names a part and inOrderOf's options", () => {
    const parts: QueryPart[] = ["order", "limit"];
    const options: InOrderOfOptions = { filter: false };

    const typed = () => User.unscope(...parts).inOrderOf("role", ["admin"], options);
    void typed;
  });
});
