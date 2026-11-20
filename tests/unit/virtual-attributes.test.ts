/* oxlint-disable typescript/no-unsafe-declaration-merging -- each interface stands in for the
   declarations active-record schema generates, which merge from another file: the accessors they
   type are defined when the Model's attributes resolve. */
// Virtual attributes (#356): declared in `static attributes` with `virtual: true`, cast and
// tracked like a column's, never a column. These tests need no database.
import { describe, expect, expectTypeOf, test } from "vite-plus/test";
import {
  InvalidModel,
  Model,
  UnknownAttribute,
  type Errors,
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
  models: { User: "users", Clashing: "users", Unset: "users", Listed: "users", Generated: "users" },
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

  test("tracks its changes", () => {
    const user = db.model(User).build({ email: "jane@example.com" });
    user.termsOfService = true;

    expect(user.changes()).toMatchObject({ termsOfService: [null, true] });
    expect(user.isAttributeChanged("termsOfService")).toBe(true);
  });

  test("is in attributes()", () => {
    const user = db.model(User).build({ email: "jane@example.com", termsOfService: true });

    expect(user.attributes()).toMatchObject({ termsOfService: true });
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

  test("with a generated id is a compile error, and an InvalidModel", () => {
    const generated = {
      // @ts-expect-error -- a generated id is a stored key, and a virtual attribute isn't stored
      token: { type: "string", virtual: true, generateId: true },
    } as const satisfies Overrides;
    class Generated extends AppRecord {
      static override table = "users";
      static override attributes: Overrides = generated as never;
    }
    expect(() => db.model(Generated)).toThrow(
      new InvalidModel("Generated.token has both virtual and generateId; keep one"),
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

describe("a virtual attribute on a declared Model", () => {
  class Visitor extends Model.define({
    id: { type: "integer", null: false },
    email: "string",
    termsOfService: { type: "boolean", virtual: true, default: () => false },
  }) {}

  test("is typed, cast and defaulted like a generated Model's", () => {
    const visitor = db
      .model(Visitor)
      .build(Visitor.permit({ termsOfService: "1" }, "termsOfService"));

    expectTypeOf(visitor.termsOfService).toEqualTypeOf<boolean | null>();
    expect(visitor.termsOfService).toBe(true);
    expect(db.model(Visitor).build().termsOfService).toBe(false);
  });

  test("with a column is a compile error, and an InvalidModel", () => {
    expect(() => {
      class Columned extends Model.define({
        id: { type: "integer", null: false },
        // @ts-expect-error -- a virtual attribute has no column
        nickname: { type: "string", virtual: true, column: "nick" },
      }) {}
      return db.model(Columned);
    }).toThrow(new InvalidModel("Columned.nickname has both virtual and column; keep one"));
  });
});

/** Validates `record`, returning its errors as `attribute type`, and their full messages. */
async function errorsOf(record: { isValid(): Promise<boolean>; errors: Errors }) {
  await record.isValid();
  const { errors } = record;
  return [
    ...errors.toArray().map(({ attribute, type }) => `${attribute} ${type}`),
    ...errors.fullMessages(),
  ];
}

describe("confirmation", () => {
  class Signup extends Model.define({
    id: "integer",
    email: "string",
    emailConfirmation: { type: "string", virtual: true },
    code: "string",
    codeConfirmation: { type: "string", virtual: true },
  }) {
    static table = "signups";
    static {
      this.validates("email", { confirmation: true });
      this.validates("code", { confirmation: { caseSensitive: false } });
    }
  }
  const signups = connect({} as never).model(Signup);

  test("passes a confirmation that matches", async () => {
    const signup = signups.build({
      email: "jane@example.com",
      emailConfirmation: "jane@example.com",
    });

    expect(await errorsOf(signup)).toEqual([]);
  });

  test("fails one that doesn't, on the confirmation, naming the attribute", async () => {
    const signup = signups.build({
      email: "jane@example.com",
      emailConfirmation: "jane@exmaple.com",
    });

    expect(await errorsOf(signup)).toEqual([
      "emailConfirmation confirmation",
      "Email confirmation doesn't match Email",
    ]);
  });

  test("skips a null confirmation, as Rails does", async () => {
    expect(await errorsOf(signups.build({ email: "jane@example.com" }))).toEqual([]);
  });

  test("compares case-sensitively unless caseSensitive is false", async () => {
    const signup = signups.build({
      email: "jane@example.com",
      emailConfirmation: "JANE@example.com",
      code: "abc",
      codeConfirmation: "ABC",
    });

    expect(await errorsOf(signup)).toEqual([
      "emailConfirmation confirmation",
      "Email confirmation doesn't match Email",
    ]);
  });

  test("without a virtual attribute for the confirmation is an InvalidModel", () => {
    expect(
      () =>
        class Account extends Model.define({ id: "integer", password: "string" }) {
          static {
            this.validates("password", { confirmation: true });
          }
        },
    ).toThrow(
      new InvalidModel(
        'Account validates("password", { confirmation }), so it needs a virtual attribute ' +
          'passwordConfirmation: { type: "string", virtual: true }',
      ),
    );
  });
});

describe("uniqueness on a virtual attribute", () => {
  test("is an UnknownAttribute when it's declared, since it has no column to query", () => {
    expect(
      () =>
        class Nicknamed extends Model.define({
          id: "integer",
          nickname: { type: "string", virtual: true },
        }) {
          static {
            this.validates("nickname", { uniqueness: true });
          }
        },
    ).toThrow(
      new UnknownAttribute(
        "Nicknamed.nickname is a virtual attribute, which has no column to query",
      ),
    );
  });
});

describe("acceptance on a virtual attribute", () => {
  class Registration extends Model.define({
    id: "integer",
    termsOfService: { type: "boolean", virtual: true },
  }) {
    static table = "registrations";
    static {
      this.validates("termsOfService", { acceptance: true });
    }
  }
  const registrations = connect({} as never).model(Registration);

  // A guard: acceptance reads the attribute as any validator does.
  test("passes a ticked box from a form, and fails an unticked one", async () => {
    const form = (ticked: string) =>
      Registration.permit({ termsOfService: ticked }, "termsOfService");

    expect(await errorsOf(registrations.build(form("1")))).toEqual([]);
    expect(await errorsOf(registrations.build(form("0")))).toEqual([
      "termsOfService accepted",
      "Terms of service must be accepted",
    ]);
  });
});
