import { inspect } from "node:util";
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { hasMany, Model } from "../../src/index.ts";
import type { QueryEvent } from "../../src/executor.ts";
import { openHarness, type Harness } from "../support/harness.ts";

class Sample extends Model.define({
  id: { type: "integer", null: false },
  label: "string",
  quantity: "integer",
}) {
  static table = "samples";
}

class Setting extends Model.define({
  id: { type: "integer", null: false },
  settings: "json",
}) {
  static table = "samples";
}

// A filtered attribute that can be null: its label.
class Secret extends Model.define({
  id: { type: "integer", null: false },
  label: "string",
}) {
  static table = "samples";
  static override filterAttributes = ["label"];
}

class User extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false }, // filtered by default: "email"
  role: "string",
}) {
  static table = "users";

  posts = hasMany(Post);
}

class Post extends Model.define({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
}) {
  static table = "posts";
}

// Validations that fail without a value: a presence check on its label.
class Checked extends Model.define({
  id: { type: "integer", null: false },
  label: "string",
}) {
  static table = "samples";

  static {
    this.validates("label", { presence: true });
  }
}

class Hider extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  role: "string",
}) {
  static table = "users";
  static override filterAttributes = [];
  static hiddenAttributes = ["email"];
}

// How a record prints in a console, a log or a test failure (#104).
describe("inspect", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.reset("samples", "posts", "users");
  });

  test("a record prints its class and attributes", async () => {
    const sample = await harness
      .connect()
      .model(Sample)
      .create({ id: 1, label: "bolt", quantity: 36 });

    expect(inspect(sample)).toBe("Sample { id: 1, label: 'bolt', quantity: 36 }");
  });

  test("a new record prints every attribute, null where none is assigned yet", () => {
    const sample = harness.connect().model(Sample).build({ label: "bolt" });

    expect(inspect(sample)).toBe("Sample { id: null, label: 'bolt', quantity: null }");
  });

  test("a partial record prints only the columns it loaded", async () => {
    await harness.connect().model(Sample).create({ id: 1, label: "bolt", quantity: 36 });
    const [sample] = await harness.connect().model(Sample).select("id", "label").toArray();

    expect(inspect(sample)).toBe("Sample { id: 1, label: 'bolt' }");
  });

  describe("a filtered attribute", () => {
    const row = { id: 1, email: "ada@example.com", role: null };

    test("prints as [FILTERED], unquoted so it isn't mistaken for a string", async () => {
      const user = await harness.connect().model(User).create(row);

      expect(inspect(user)).toBe("User { id: 1, email: [FILTERED], role: null }");
    });

    test("is highlighted as a special value when colors are on", async () => {
      const user = await harness.connect().model(User).create(row);

      expect(inspect(user, { colors: true })).toContain("email: \u001b[36m[FILTERED]\u001b[39m");
    });

    test("prints null when it has no value, as there is nothing to hide", () => {
      const user = harness.connect().model(User).build({});

      expect(inspect(user)).toBe("User { id: null, email: null, role: null }");
    });
  });

  test("a destroyed record still prints its last attributes", async () => {
    const sample = await harness.connect().model(Sample).create({ id: 1, label: "bolt" });
    await sample.destroy();

    expect(inspect(sample)).toBe("Sample { id: 1, label: 'bolt', quantity: null }");
  });

  test("a hidden attribute is still shown: hiding is for serializing, not for logs", async () => {
    const hider = await harness
      .connect()
      .model(Hider)
      .create({ id: 1, email: "ada@example.com", role: "admin" });

    expect(inspect(hider)).toBe("Hider { id: 1, email: 'ada@example.com', role: 'admin' }");
  });

  test("a record in an array or object prints in place, and depth is respected", async () => {
    const sample = await harness.connect().model(Sample).create({ id: 1, label: "bolt" });

    expect(inspect([sample])).toBe("[ Sample { id: 1, label: 'bolt', quantity: null } ]");
    expect(inspect({ sample }, { depth: 0 })).toBe("{ sample: [Sample] }");
    expect(inspect({ sample }, { depth: 1 })).toContain("sample: Sample { id: 1,");
  });

  describe("an unsaved change", () => {
    test("is flagged with the value it had", async () => {
      const sample = await harness
        .connect()
        .model(Sample)
        .create({ id: 1, label: "bolt", quantity: 36 });
      sample.label = "nut";

      expect(inspect(sample)).toBe("Sample { id: 1, label: 'nut' (was 'bolt'), quantity: 36 }");
    });

    test("is not flagged once saved", async () => {
      const sample = await harness
        .connect()
        .model(Sample)
        .create({ id: 1, label: "bolt", quantity: 36 });
      await sample.update({ label: "nut" });

      expect(inspect(sample)).toBe("Sample { id: 1, label: 'nut', quantity: 36 }");
    });

    test("is not flagged on a new record, where everything is unsaved", () => {
      const sample = harness.connect().model(Sample).build({ label: "bolt" });

      expect(inspect(sample)).toBe("Sample { id: null, label: 'bolt', quantity: null }");
    });

    test("on a column a partial record never loaded says only that it changed", async () => {
      await harness.connect().model(Sample).create({ id: 1, label: "bolt", quantity: 36 });
      const [sample] = await harness.connect().model(Sample).select("id").toArray();
      sample!.label = "nut";

      expect(inspect(sample)).toBe("Sample { id: 1, label: 'nut' (changed) }");
    });

    test("in a filtered attribute that became null still says it changed", async () => {
      const secret = await harness.connect().model(Secret).create({ id: 1, label: "open sesame" });
      secret.label = null;

      expect(inspect(secret)).toBe("Secret { id: 1, label: [FILTERED] (changed) }");
    });

    test("in a filtered attribute says only that it changed", async () => {
      const user = await harness
        .connect()
        .model(User)
        .create({ id: 1, email: "ada@example.com", role: "admin" });
      user.email = "grace@example.com";

      expect(inspect(user)).toBe("User { id: 1, email: [FILTERED] (changed), role: 'admin' }");
    });
  });

  describe("a Relation", () => {
    const flat = { breakLength: Infinity };

    test("prints its Model and the SELECT it would send, and sends nothing", () => {
      const events: QueryEvent[] = [];
      const db = harness.connect({ onQuery: (event) => events.push(event) });
      const relation = db.model(Sample).where({ label: "bolt" }).order({ id: "asc" }).limit(5);

      expect(inspect(relation, flat)).toBe(
        "Relation<Sample> { " +
          `sql: 'SELECT * FROM "samples" WHERE (("label" = ?)) ORDER BY "id" ASC LIMIT ?', ` +
          "params: [ 'bolt', 5 ] }",
      );
      expect(events).toEqual([]);
    });

    test("shows a filtered value as [FILTERED]", () => {
      const relation = harness.connect().model(User).where({ email: "ada@example.com" });

      expect(inspect(relation, flat)).toContain("params: [ [FILTERED] ]");
    });

    test("a hasMany of a record prints its owner's key as a param", async () => {
      const user = await harness
        .connect()
        .model(User)
        .create({ id: 7, email: "ada@example.com", role: null });

      expect(inspect(user.posts(), flat)).toContain("params: [ 7 ]");
    });

    test("prints as [Relation] when nested deeper than depth allows", () => {
      const relation = harness.connect().model(Sample);

      expect(inspect({ relation }, { depth: 0 })).toBe("{ relation: [Relation] }");
    });
  });

  describe("a record's errors", () => {
    test("print each failure's attribute, type and message", async () => {
      const checked = harness.connect().model(Checked).build({ id: 1 });
      await checked.isValid();

      expect(inspect(checked.errors)).toBe(
        "Errors [ { attribute: 'label', type: 'blank', message: \"can't be blank\" } ]",
      );
    });

    test("print as an empty list when there are none", () => {
      const checked = harness.connect().model(Checked).build({ id: 1, label: "bolt" });

      expect(inspect(checked.errors)).toBe("Errors []");
    });

    test("past depth, print as [Errors]", async () => {
      const checked = harness.connect().model(Checked).build({ id: 1 });
      await checked.isValid();

      expect(inspect({ errors: checked.errors }, { depth: 0 })).toBe("{ errors: [Errors] }");
    });
  });

  describe("depth", () => {
    const nested = { a: { b: 1 } };

    test("a record's attributes are as deep as the same object's would be", async () => {
      const setting = await harness.connect().model(Setting).create({ id: 1, settings: nested });

      expect(inspect(setting, { depth: 1 })).toBe("Setting { id: 1, settings: { a: [Object] } }");
      expect(inspect(setting, { depth: 0 })).toBe("Setting { id: 1, settings: [Object] }");
    });

    test("a nested record counts the levels above it", async () => {
      const setting = await harness.connect().model(Setting).create({ id: 1, settings: nested });

      expect(inspect({ setting }, { depth: 2 })).toBe(
        "{ setting: Setting { id: 1, settings: { a: [Object] } } }",
      );
    });
  });
});
