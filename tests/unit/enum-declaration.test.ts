import { describe, expect, test } from "vite-plus/test";
import { InvalidModel, Model } from "../../packages/active-record/src/index.ts";
import { connect, d1 } from "../../packages/active-record/src/adapters/d1/index.ts";

// connect() never touches the binding until a query runs, and these tests run none.
const db = connect({} as never);

/** A Model whose one attribute has `spec`, past the types, as plain JavaScript could declare it. */
const withSpec = (spec: unknown) =>
  class Sample extends Model.define({ id: "integer", value: spec as never }) {
    static override table = "samples";
  };

describe("an enum's declaration, past the types (#340)", () => {
  test.each([
    [
      { type: "integer", enum: ["low"] },
      'Sample.value is "integer", so its enum gives each name the integer it\'s stored as, not a list of names',
    ],
    [
      { type: "integer", enum: { low: "l" } },
      'Sample.value is "integer", so its enum stores integers, not "l" for "low"',
    ],
    [
      { type: "integer", enum: { low: 1.5 } },
      'Sample.value is "integer", so its enum stores integers, not 1.5 for "low"',
    ],
    [
      { type: "string", enum: { draft: 0 } },
      'Sample.value is "string", so its enum stores text, not 0 for "draft"',
    ],
    [{ type: "string", enum: [] }, "Sample.value has an enum with no names; give it at least one"],
    [{ type: "string", enum: ["a", "a"] }, 'Sample.value\'s enum names "a" twice'],
    [
      { type: "integer", enum: { low: 0, none: 0 } },
      'Sample.value\'s enum stores 0 for both "low" and "none"',
    ],
    [
      { type: "string", enum: "draft" },
      'Sample.value has an enum "draft"; give it a list of names, or an object of names and the values they\'re stored as',
    ],
    [
      { type: "string", enum: true },
      "Sample.value has enum: true, which only a generated Model's override gives, for the names its database lists; give it a list of names, or an object of names and the values they're stored as",
    ],
    [
      { type: "string", enum: false },
      "Sample.value has enum: false, which only a generated Model's override gives, for the names its database lists; give it a list of names, or an object of names and the values they're stored as",
    ],
    [
      { type: "string", prefix: true },
      "Sample.value has a prefix but no enum; give it an enum, or remove a prefix",
    ],
    [
      { type: "string", enum: ["a"], suffix: "" },
      'Sample.value has a suffix ""; use true for the attribute\'s name, or a word',
    ],
    [
      { type: "boolean", enum: { on: 1 } },
      'Sample.value is "boolean", so it can\'t have an enum: an enum is stored as text or integers',
    ],
  ])("%j is an InvalidModel", (spec, message) => {
    expect(() => db.model(withSpec(spec)).build()).toThrow(new InvalidModel(message));
  });
});

describe("an enum's method names, when the Model is first used (#340)", () => {
  const firstUse = (model: Parameters<typeof db.model>[0]) => () => db.model(model).build();

  test("two enums giving one method name is an InvalidModel suggesting a prefix or a suffix", () => {
    class Conversation extends Model.define({
      id: "integer",
      status: { type: "string", enum: ["active", "archived"] },
      comments: { type: "string", enum: ["active", "closed"] },
    }) {}

    expect(firstUse(Conversation)).toThrow(
      new InvalidModel(
        'Conversation\'s enums status and comments both give a method named "isActive"; give one a prefix or a suffix',
      ),
    );
  });

  test("a name that gives a record method's name is an InvalidModel", () => {
    class Doc extends Model.define({
      id: "integer",
      state: { type: "string", enum: ["changed"] },
    }) {}

    expect(firstUse(Doc)).toThrow(
      new InvalidModel(
        'Doc\'s enum state gives a method named "isChanged", which is the name of a record method; give state a prefix or a suffix',
      ),
    );
  });

  test("a name that gives a Relation method's or a Model static's name is an InvalidModel", () => {
    class Step extends Model.define({
      id: "integer",
      place: { type: "string", enum: ["first"] },
    }) {}

    expect(firstUse(Step)).toThrow(
      new InvalidModel(
        'Step\'s enum place gives a scope named "first", which is the name of a Relation method or a Model static; give place a prefix or a suffix',
      ),
    );
  });

  test.each([
    [
      ["new"],
      'Step\'s enum place gives a scope named "new", which is a reserved word; give place a prefix or a suffix',
    ],
    [
      ["bind"],
      'Step\'s enum place gives a scope named "bind", which is the name of a Function method; give place a prefix or a suffix',
    ],
    [
      ["in-progress"],
      'Step\'s enum place gives a method named "isIn-progress", which isn\'t a name TypeScript can declare; name it with letters, digits, _ and $, and map it to the value it\'s stored as ({ inProgress: "in-progress" })',
    ],
    [
      ["1st"],
      "Step's enum place gives a scope named \"1st\", which isn't a name TypeScript can declare; name it with letters, digits, _ and $, and map it to the value it's stored as",
    ],
  ])("a name %j whose methods can't be declared is an InvalidModel", (names, message) => {
    class Step extends Model.define({
      id: "integer",
      place: { type: "string", enum: names as never },
    }) {}

    expect(firstUse(Step)).toThrow(new InvalidModel(message));
  });

  test("a name in any script's letters is declared", () => {
    class Café extends Model.define({ id: "integer", menu: { type: "string", enum: ["café"] } }) {}

    expect(db.model(Café).build({ menu: "café" }).isCafé()).toBe(true);
  });

  test("a name that gives an attribute's name is an InvalidModel", () => {
    class Light extends Model.define({
      id: "integer",
      isOn: "boolean",
      state: { type: "string", enum: ["on"] },
    }) {}

    expect(firstUse(Light)).toThrow(
      new InvalidModel(
        'Light\'s enum state gives a method named "isOn", which is the name of an attribute; give state a prefix or a suffix',
      ),
    );
  });

  test("a static the Model declares with an enum's method name is an InvalidModel", () => {
    class Post extends Model.define({
      id: "integer",
      status: { type: "string", enum: ["draft", "published"] },
    }) {
      static override published = this.scope((q) => q.where({ id: 1 }));
    }

    expect(firstUse(Post)).toThrow(
      new InvalidModel(
        'Post declares "published", which is also the name of a scope its enum status gives; rename it, or give status a prefix or a suffix',
      ),
    );
  });

  describe("on a generated Model", () => {
    const schema = {
      adapter: d1({ binding: "DB" }),
      tables: { posts: { attributes: { id: "integer", status: "string" }, primaryKey: "id" } },
    } as const;
    abstract class AppRecord extends Model {
      static override schema = schema;
    }

    test("a static it declares with an enum scope's name is an InvalidModel, not replaced", () => {
      class Post extends AppRecord {
        static override attributes = { status: { enum: ["draft", "published"] } } as const;
        static published = this.scope((q) => q.where({ id: 1 }));
      }

      expect(firstUse(Post)).toThrow(
        new InvalidModel(
          'Post declares "published", which is also the name of a scope its enum status gives; rename it, or give status a prefix or a suffix',
        ),
      );
    });

    test("a record method it declares with an enum method's name is its own", () => {
      class Post extends AppRecord {
        static override attributes = { status: { enum: ["draft"] } } as const;

        isDraft(): boolean {
          return true;
        }
      }

      expect(db.model(Post).build().isDraft()).toBe(true);
    });
  });
});
