import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import {
  column,
  ActiveRecordError,
  InvalidModel,
  Model,
  sql,
  UnknownAttribute,
} from "../../packages/active-record/src/index.ts";
import { openHarness, type Harness } from "../support/harness.ts";

describe("model declaration", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());

  test("a model without a table uses the one inferred from its class name", async () => {
    class User extends Model.define({ id: "integer", email: "string" }) {}
    const users = harness.connect().model(User);

    await users.insert({ id: 7, email: "inferred@example.com" });

    expect(await users.find(7).then((user) => user.email)).toBe("inferred@example.com");
    await users.where({ id: 7 }).deleteAll();
  });

  test("a model that sets modelName uses the table inferred from it", async () => {
    // As a bundler that renames classes leaves it: named e, but still the User Model.
    const e = class extends Model.define({ id: "integer", email: "string" }) {
      static modelName = "User";
    };
    const users = harness.connect().model(e);

    await users.insert({ id: 8, email: "named@example.com" });

    expect(await users.find(8).then((user) => user.email)).toBe("named@example.com");
    await users.where({ id: 8 }).deleteAll();
  });

  test("an empty table is rejected when first used", () => {
    class Nameless extends Model.define({ id: "integer" }) {
      static table = "";
    }

    const use = () => harness.connect().model(Nameless);

    expect(use).toThrow(InvalidModel);
    expect(use).toThrow(/Nameless.*table/);
    expect(use).toThrow(ActiveRecordError);
  });

  test("a modelName that isn't a string is rejected when first used", () => {
    // Past the types: a JavaScript Model file, or a cast.
    class Numbered extends Model.define({ id: "integer" }) {
      static modelName = 1 as unknown as string;
    }
    class Unset extends Model.define({ id: "integer" }) {
      static modelName = undefined as unknown as string;
    }

    for (const model of [Numbered, Unset]) {
      expect(() => harness.connect().model(model)).toThrow(
        new InvalidModel(
          `${model.name}'s modelName must be a string; remove it to use the class name`,
        ),
      );
    }
  });

  test("a missing table whose name was inferred says where the name came from", async () => {
    // What a minifier without keep_names does: the class is now called e, so its table "es".
    const e = class extends Model.define({ id: "integer" }) {};
    const db = harness.connect();

    // Both start now, so each gets its handler now: one left unhandled while the other is
    // asserted on would be reported as an unhandled rejection if it settled first (#106).
    const errors = await Promise.all(
      [db.model(e).toArray(), db.batch((b) => [b.insert(e, { id: 1 })])].map((attempt) =>
        attempt.then(
          () => undefined,
          (error: unknown) => error,
        ),
      ),
    );

    expect(errors).toHaveLength(2);
    for (const error of errors) {
      expect(error).toBeInstanceOf(InvalidModel);
      expect(error).toHaveProperty("cause", expect.any(Error));
      expect(error).toHaveProperty(
        "message",
        expect.stringMatching(
          /e's table "es" doesn't exist in \S+ \(inferred from the modelName e; create it, set static table, or set static modelName if your bundler renames classes\)/,
        ),
      );
    }
  });

  test("a missing table that was declared is the database's own error, as before", async () => {
    class Missing extends Model.define({ id: "integer" }) {
      static table = "nowhere";
    }

    const read = harness.connect().model(Missing).toArray();

    await expect(read).rejects.toThrow(Error);
    await expect(read).rejects.not.toThrow(InvalidModel);
  });

  test("a class field that would hide an attribute's accessor is rejected when first used", () => {
    class Shadowed extends Model.define({ id: "integer", email: "string" }) {
      static table = "users";
      email!: string | null; // should have been left to Model.define({...})
    }

    expect(() => harness.connect().model(Shadowed)).toThrow(/Shadowed.*"email"/);
  });

  test("where rejects a key that isn't a declared attribute", () => {
    class User extends Model.define({ id: "integer", email: "string" }) {
      static table = "users";
    }
    const users = harness.connect().model(User);

    // @ts-expect-error `emial` isn't an attribute of User
    expect(() => users.where({ emial: "a@example.com" })).toThrow(UnknownAttribute);
    // @ts-expect-error columns aren't attributes: the attribute would be `createdAt`
    expect(() => users.where({ created_at: null })).toThrow(/User.*"created_at"/);
  });

  test("an attribute named like a record method is rejected when first used", () => {
    class Clashing extends Model.define({ id: "integer", attributes: "json" }) {
      static table = "users";
    }

    expect(() => harness.connect().model(Clashing)).toThrow(/Clashing.*"attributes"/);
  });

  test("column() naming an unknown attribute is rejected as soon as where is called", () => {
    class User extends Model.define({ id: "integer", createdAt: "datetime" }) {
      static table = "users";
    }
    const users = harness.connect().model(User);

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

    expect(() => harness.connect().model(Keyless)).toThrow(/Keyless.*primaryKey "id"/);
    expect(() => harness.connect().model(WrongKey)).toThrow(InvalidModel);
  });

  test("errors and abortReason are reserved: they're record properties", () => {
    class WithErrors extends Model.define({ id: "integer", errors: "json" }) {
      static table = "users";
    }
    class WithReason extends Model.define({ id: "integer", abortReason: "string" }) {
      static table = "users";
    }

    expect(() => harness.connect().model(WithErrors)).toThrow(
      /WithErrors.*"errors".*record method or property/,
    );
    expect(() => harness.connect().model(WithReason)).toThrow(InvalidModel);
  });
});
