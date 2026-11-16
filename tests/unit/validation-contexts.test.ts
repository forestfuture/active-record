import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import { connect } from "../../packages/active-record/src/adapters/d1/index.ts";
import {
  InvalidModel,
  Model,
  type Batch,
  type SaveOptions,
  type ValidationContexts,
} from "../../packages/active-record/src/index.ts";

const db = connect({} as never);

class Note extends Model.define({ id: "integer", body: "string" }) {
  static table = "notes";
}

describe("validation contexts' types", () => {
  test("on and exceptOn take a context's name or a list of them", () => {
    class Draft extends Model.define({ id: "integer", body: "string" }) {
      static table = "notes";
      static validationContexts = ["publish"] as const;
      static {
        this.validates("body", { presence: true, on: "create" });
        this.validates("body", { presence: true, on: ["update", "publish"] });
        this.validates("body", { presence: true, exceptOn: "create" });
        // @ts-expect-error "draft" isn't one of Draft's validationContexts
        this.validates("body", { presence: true, exceptOn: "draft" });
        // @ts-expect-error a context is a name, not a function
        this.validates("body", { presence: true, on: () => true });
      }
    }

    expect(Draft.name).toBe("Draft");
  });

  test("only the validation callbacks take on", () => {
    class Draft extends Model.define({ id: "integer", body: "string" }) {
      static table = "notes";
      static validationContexts = ["publish"] as const;
      static {
        this.beforeValidation(() => undefined, { on: "create" });
        this.afterValidation(() => undefined, { on: ["update", "publish"] });
        // @ts-expect-error beforeSave runs on every save; it takes no on
        this.beforeSave(() => undefined, { on: "create" });
      }
    }

    expect(Draft.name).toBe("Draft");
  });

  test("isValid takes a context, and save and saveOrThrow take one as an option", () => {
    expectTypeOf<Note["isValid"]>().parameters.toEqualTypeOf<[context?: ValidationContexts]>();
    expectTypeOf<Note["save"]>().parameters.toEqualTypeOf<[options?: SaveOptions]>();
    expectTypeOf<Note["saveOrThrow"]>().parameters.toEqualTypeOf<[options?: SaveOptions]>();
    expectTypeOf<SaveOptions>().toEqualTypeOf<{ context?: ValidationContexts }>();
  });

  test("a batch's save takes a context as an option, and its destroy takes none", () => {
    expectTypeOf<Parameters<Batch["save"]>>().toEqualTypeOf<
      [record: Model, options?: SaveOptions]
    >();
    expectTypeOf<Parameters<Batch["destroy"]>>().toEqualTypeOf<[record: Model]>();
  });
});

describe("a Model's validation contexts", () => {
  test("a subclass names its parent's", () => {
    class Draft extends Model.define({ id: "integer", body: "string" }) {
      static table = "notes";
      static validationContexts = ["publish"] as const;
    }
    class Memo extends Draft {
      static {
        this.validates("body", { presence: true, on: "publish" });
        // @ts-expect-error "draft" isn't one of the validationContexts Memo inherits
        this.validates("body", { presence: true, on: "draft" });
      }
    }

    expect(Memo.name).toBe("Memo");
  });

  test("an abstract class can't list them", () => {
    abstract class Shared extends Model {
      static override abstract = true;
      static validationContexts = ["signup"] as const;
    }
    class Account extends Shared.define({ id: "integer" }) {
      static table = "accounts";
    }

    expect(() => db.model(Account)).toThrow(
      new InvalidModel(
        "Shared is an abstract base class; list validationContexts on each Model instead",
      ),
    );
  });

  test("a base class's validation callback runs only on create or update", () => {
    abstract class Shared extends Model {
      static override abstract = true;
      static {
        this.beforeValidation(() => undefined, { on: "signup" as never });
      }
    }
    class Account extends Shared.define({ id: "integer" }) {
      static table = "accounts";
      static validationContexts = ["signup"] as const;
    }

    expect(() => db.model(Account)).toThrow(
      new InvalidModel(
        'Shared\'s beforeValidation runs on "signup", but an abstract base class has only ' +
          '"create" and "update"; declare it on each Model that lists "signup"',
      ),
    );
  });

  test("an inherited declaration's error names the list it was checked against", () => {
    class Invite extends Model.define({ id: "integer", role: "string" }) {
      static table = "invites";
      static validationContexts = ["signup", "invite"] as const;
      static {
        this.validates("role", { presence: true, on: "invite" });
      }
    }
    class Signup extends Invite {}
    // Only plain JavaScript (or a cast) can narrow an inherited list: TypeScript refuses it.
    Object.defineProperty(Signup, "validationContexts", { value: ["signup"] });

    expect(() => db.model(Signup)).toThrow(
      new InvalidModel(
        'Invite validates "role" on "invite", which isn\'t "create", "update" or one of ' +
          'Signup\'s validationContexts ("signup"); list it in static validationContexts',
      ),
    );
  });

  test("a validation callback naming a context the Model doesn't list is InvalidModel", () => {
    class Draft extends Model.define({ id: "integer", body: "string" }) {
      static table = "notes";
      static {
        // @ts-expect-error a Model without validationContexts has only "create" and "update"
        this.afterValidation(() => undefined, { on: ["update", "publish"] });
      }
    }

    expect(() => db.model(Draft)).toThrow(
      new InvalidModel(
        'Draft\'s afterValidation runs on "publish", which isn\'t "create" or "update"; ' +
          "list it in static validationContexts",
      ),
    );
  });
});
