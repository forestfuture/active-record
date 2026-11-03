import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import {
  column,
  connect,
  ActiveRecordError,
  InvalidModel,
  Model,
  sql,
  UnknownAttribute,
} from "../../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

describe("model declaration", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
  });
  afterAll(() => dispose());

  test("a model without a table uses the one inferred from its class name", async () => {
    class User extends Model.define({ id: "integer", email: "string" }) {}
    const users = connect(binding).model(User);

    await users.insert({ id: 7, email: "inferred@example.com" });

    expect(await users.find(7).then((user) => user.email)).toBe("inferred@example.com");
    await users.where({ id: 7 }).deleteAll();
  });

  test("an empty table is rejected when first used", () => {
    class Nameless extends Model.define({ id: "integer" }) {
      static table = "";
    }

    const use = () => connect(binding).model(Nameless);

    expect(use).toThrow(InvalidModel);
    expect(use).toThrow(/Nameless.*table/);
    expect(use).toThrow(ActiveRecordError);
  });

  test("a missing table whose name was inferred says where the name came from", async () => {
    // What a minifier without keep_names does: the class is now called e, so its table "es".
    const e = class extends Model.define({ id: "integer" }) {};
    const db = connect(binding);

    // Both start now, so each gets its handler now: one left unhandled while the other is
    // asserted on would be reported as an unhandled rejection if it settled first (#106).
    const errors = await Promise.all(
      [db.model(e).toArray(), db.batch([db.model(e).toInsert({ id: 1 })])].map((attempt) =>
        attempt.then(
          () => undefined,
          (error: unknown) => error,
        ),
      ),
    );

    expect(errors).toHaveLength(2);
    for (const error of errors) {
      expect(error).toBeInstanceOf(InvalidModel);
      expect(error).toHaveProperty("cause.message", expect.stringMatching(/no such table: es/));
      expect(error).toHaveProperty(
        "message",
        expect.stringMatching(
          /e's table "es" doesn't exist in D1 \(inferred from the class name e; create it, set static table, or keep class names if your bundler renames them\)/,
        ),
      );
    }
  });

  test("a missing table that was declared is D1's own error, as before", async () => {
    class Missing extends Model.define({ id: "integer" }) {
      static table = "nowhere";
    }

    const read = connect(binding).model(Missing).toArray();

    await expect(read).rejects.toThrow(/no such table: nowhere/);
    await expect(read).rejects.not.toThrow(InvalidModel);
  });

  test("a class field that would hide an attribute's accessor is rejected when first used", () => {
    class Shadowed extends Model.define({ id: "integer", email: "string" }) {
      static table = "users";
      email!: string | null; // should have been left to Model.define({...})
    }

    expect(() => connect(binding).model(Shadowed)).toThrow(/Shadowed.*"email"/);
  });

  test("where rejects a key that isn't a declared attribute", () => {
    class User extends Model.define({ id: "integer", email: "string" }) {
      static table = "users";
    }
    const users = connect(binding).model(User);

    // @ts-expect-error `emial` isn't an attribute of User
    expect(() => users.where({ emial: "a@example.com" })).toThrow(UnknownAttribute);
    // @ts-expect-error columns aren't attributes: the attribute would be `createdAt`
    expect(() => users.where({ created_at: null })).toThrow(/User.*"created_at"/);
  });

  test("an attribute named like a record method is rejected when first used", () => {
    class Clashing extends Model.define({ id: "integer", attributes: "json" }) {
      static table = "users";
    }

    expect(() => connect(binding).model(Clashing)).toThrow(/Clashing.*"attributes"/);
  });

  test("column() naming an unknown attribute is rejected as soon as where is called", () => {
    class User extends Model.define({ id: "integer", createdAt: "datetime" }) {
      static table = "users";
    }
    const users = connect(binding).model(User);

    expect(() => users.where(sql`${column("createdAtt")} > ${new Date()}`)).toThrow(
      UnknownAttribute,
    );
  });

  test("a primaryKey that isn't a declared attribute is rejected when first used", () => {
    class Keyless extends Model.define({ email: "string" }) {
      static table = "users";
    }
    class WrongKey extends Model.define({ uuid: "string" }) {
      static table = "users";
      static primaryKey = "id";
    }

    expect(() => connect(binding).model(Keyless)).toThrow(/Keyless.*primaryKey "id"/);
    expect(() => connect(binding).model(WrongKey)).toThrow(InvalidModel);
  });

  test("errors and abortReason are reserved: they're record properties", () => {
    class WithErrors extends Model.define({ id: "integer", errors: "json" }) {
      static table = "users";
    }
    class WithReason extends Model.define({ id: "integer", abortReason: "string" }) {
      static table = "users";
    }

    expect(() => connect(binding).model(WithErrors)).toThrow(
      /WithErrors.*"errors".*record method or property/,
    );
    expect(() => connect(binding).model(WithReason)).toThrow(InvalidModel);
  });
});
