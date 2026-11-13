import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import { InvalidModel, Model } from "../../packages/active-record/src/index.ts";
import { connect } from "../../packages/active-record/src/adapters/d1/index.ts";

const db = connect({} as never);

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

  test("one that isn't a string is an InvalidModel when the Model is first used", () => {
    // Past the types: a JavaScript Model file, or a cast.
    class Numbered extends Model.define({ id: "integer" }) {
      static modelName = 1 as unknown as string;
    }
    class Unset extends Model.define({ id: "integer" }) {
      static modelName = undefined as unknown as string;
    }

    for (const model of [Numbered, Unset]) {
      expect(() => db.model(model)).toThrow(
        new InvalidModel(
          `${model.name}'s modelName must be a string; remove it to use the class name`,
        ),
      );
    }
  });
});
