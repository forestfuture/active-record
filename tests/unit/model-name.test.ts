import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import { Model } from "../../packages/active-record/src/index.ts";

class User extends Model.define({ id: "integer" }) {}

describe("modelName", () => {
  test("is the class name unless set, a subclass's its own", () => {
    class Admin extends User {}

    expect([User.modelName, Admin.modelName]).toEqual(["User", "Admin"]);
    expectTypeOf(User.modelName).toEqualTypeOf<string>();
  });

  test("a class with no name reads an empty one", () => {
    const anonymous = [class extends Model.define({ id: "integer" }) {}][0]!;
    const defaultExport = { default: class extends Model.define({ id: "integer" }) {} }.default;

    expect([anonymous.modelName, defaultExport.modelName]).toEqual(["", ""]);
  });

  test("a set one is what it reads, and a subclass inherits it", () => {
    class E extends Model.define({ id: "integer" }) {
      static modelName = "BlogPost";
    }
    class F extends E {}

    expect([E.modelName, F.modelName]).toEqual(["BlogPost", "BlogPost"]);
  });

  test("assigning sets it for that class, as compiled class fields and static blocks do", () => {
    class E extends Model.define({ id: "integer" }) {}
    class F extends E {}

    // What `static modelName = "…"` compiles to without useDefineForClassFields.
    E.modelName = "BlogPost";

    expect([E.modelName, F.modelName, User.modelName]).toEqual(["BlogPost", "BlogPost", "User"]);
  });
});
