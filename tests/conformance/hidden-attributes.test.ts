import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { InvalidModel, Model } from "../../packages/active-record/src/index.ts";
import { openHarness, type Harness } from "../support/harness.ts";

class User extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  role: "string",
}) {
  static table = "users";
  static hiddenAttributes = ["email"];
}

class Member extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  role: "string",
}) {
  static table = "users";
}

abstract class Base extends Model {
  static override hiddenAttributes = ["email"];
}
/** The users table's attributes, on the app's base class. */
const UserRecord = Base.define({ id: "integer", email: "string", role: "string" });

// What `toJSON()` leaves out of a record, so `Response.json(user)` can't leak it (#101).
describe("hiddenAttributes", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.exec("DELETE FROM users");
  });

  test("a Model's toJSON leaves them out, and attributes() keeps them", async () => {
    const user = await harness
      .connect()
      .model(User)
      .create({ id: 1, email: "ada@example.com", role: "admin" });

    expect(user.toJSON()).toEqual({ id: 1, role: "admin" });
    expect(JSON.parse(JSON.stringify(user))).toEqual({ id: 1, role: "admin" });
    expect(user.attributes()).toEqual({ id: 1, email: "ada@example.com", role: "admin" });
  });

  test("none are hidden by default", async () => {
    const member = await harness
      .connect()
      .model(Member)
      .create({ id: 1, email: "ada@example.com", role: "admin" });

    expect(member.toJSON()).toEqual({ id: 1, email: "ada@example.com", role: "admin" });
  });

  test("a hidden attribute a partial record didn't load is no problem", async () => {
    await harness.connect().model(User).create({ id: 1, email: "ada@example.com", role: "admin" });
    const [user] = await harness.connect().model(User).select("id", "role").toArray();

    expect(user?.toJSON()).toEqual({ id: 1, role: "admin" });
  });

  describe("on an app's base class", () => {
    const row = { id: 1, email: "ada@example.com", role: "admin" };

    test("every Model built on it inherits them", async () => {
      class Account extends UserRecord {
        static override table = "users";
      }
      const account = await harness.connect().model(Account).create(row);

      expect(account.toJSON()).toEqual({ id: 1, role: "admin" });
    });

    test("a Model's own list replaces them", async () => {
      class Account extends UserRecord {
        static override table = "users";
        static override hiddenAttributes = [...Base.hiddenAttributes, "role"];
      }
      const account = await harness.connect().model(Account).create(row);

      expect(account.toJSON()).toEqual({ id: 1 });
    });

    test("an empty list of its own hides nothing", async () => {
      class Reader extends UserRecord {
        static override table = "users";
        static override hiddenAttributes = [];
      }
      const reader = await harness.connect().model(Reader).create(row);

      expect(reader.toJSON()).toEqual(row);
    });
  });

  describe("naming one the Model doesn't have", () => {
    test("in its own list is an InvalidModel", () => {
      class Typo extends Model.define({ id: "integer", role: "string" }) {
        static override table = "users";
        static override hiddenAttributes = ["rol"];
      }

      expect(() => harness.connect().model(Typo)).toThrow(
        new InvalidModel(
          'Typo hides "rol" from toJSON, but has no such attribute; hiddenAttributes names attributes exactly',
        ),
      );
    });

    test("is ignored when the base class's list does", () => {
      const Slim = Base.define({ id: "integer", role: "string" });
      class Plain extends Slim {
        static override table = "users";
      }
      class Extended extends Slim {
        static override table = "users";
        static override hiddenAttributes = [...Base.hiddenAttributes, "role"];
      }
      const db = harness.connect();

      expect(() => db.model(Plain)).not.toThrow();
      expect(() => db.model(Extended)).not.toThrow();
    });

    test("is ignored when Model's list does", () => {
      const before = Model.hiddenAttributes;
      Model.hiddenAttributes = ["nickname"];
      try {
        class Plain extends Model.define({ id: "integer", role: "string" }) {
          static override table = "users";
        }

        expect(() => harness.connect().model(Plain)).not.toThrow();
      } finally {
        Model.hiddenAttributes = before;
      }
    });

    test("in its own list is still an InvalidModel when the base class has a list", () => {
      class Typo extends UserRecord {
        static override table = "users";
        static override hiddenAttributes = [...Base.hiddenAttributes, "rol"];
      }

      expect(() => harness.connect().model(Typo)).toThrow(InvalidModel);
    });

    test("is fine for a Model that extends another Model, which has the parent's attributes", () => {
      class Account extends UserRecord {
        static override table = "users";
      }
      class Admin extends Account {
        static override hiddenAttributes = ["role"];
      }

      expect(() => harness.connect().model(Admin)).not.toThrow();
    });
  });

  test("the list is read each time, so a change after first use applies", async () => {
    class Live extends Model.define({ id: "integer", email: "string", role: "string" }) {
      static override table = "users";
    }
    const live = await harness
      .connect()
      .model(Live)
      .create({ id: 1, email: "ada@example.com", role: "admin" });
    Live.hiddenAttributes = ["role"];

    expect(live.toJSON()).toEqual({ id: 1, email: "ada@example.com" });
  });
});
