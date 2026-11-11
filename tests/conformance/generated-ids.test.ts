import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  hasMany,
  InvalidModel,
  Model,
  RecordNotUnique,
} from "../../packages/active-record/src/index.ts";
import { d1 } from "../../packages/active-record/src/adapters/d1/index.ts";
import { openHarness, type Harness } from "../support/harness.ts";

const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

class Note extends Model.define({
  id: { type: "string", null: false, generateId: true },
  notebookId: "string",
  body: "string",
}) {}

class Notebook extends Model.define({
  id: { type: "string", null: false, generateId: true },
  title: "string",
  slug: "string",
}) {
  notes = hasMany(Note);
}

class NumberedNote extends Model.define({
  id: { type: "string", null: false, generateId: true },
  body: "string",
}) {
  static override table = "notes";

  static override generateId = () => 42 as unknown as string;
}

let issued = 0;
const sequential = () => `id-${++issued}`;

// A generated schema, as `active-record schema` writes it, for Models built on it.
const schema = {
  adapter: d1({ binding: "DB" }),
  tables: {
    notes: {
      attributes: { id: { type: "string", null: false, generateId: true }, body: "string" },
      primaryKey: "id",
    },
    notebooks: {
      attributes: {
        id: { type: "string", null: false, generateId: true },
        title: "string",
        color: { type: "string", default: () => "blue" },
      },
      primaryKey: "id",
    },
  },
  models: {
    SequentialNote: "notes",
    Given: "notebooks",
    Plain: "notebooks",
    Retyped: "notebooks",
    Titled: "notebooks",
    Colored: "notebooks",
    Doubled: "notebooks",
    Counted: "notebooks",
  },
} as const;

abstract class SequentialBase extends Model {
  static override schema = schema;
  static override generateId = sequential;
}

class SequentialNote extends SequentialBase {
  static override table = "notes";
}

abstract class ApplicationRecord extends Model {
  static override schema = schema;
}

class PrefixedNote extends Model.define({
  id: { type: "string", null: false, generateId: true },
  body: "string",
}) {
  static override table = "notes";

  static override generateId(attribute: string) {
    return `${attribute}_${super.generateId(attribute)}`;
  }
}

describe("generated ids", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await openHarness({ schema: "generated-ids" });
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.exec("DELETE FROM notes");
    await harness.exec("DELETE FROM notebooks");
    issued = 0;
  });

  test("a built record has a UUID before it's saved", () => {
    const note = harness.connect().model(Note).build({ body: "hi" });

    expect(note.id).toMatch(uuid);
  });

  test("a function assigned to the base class's generateId makes every Model's ids", async () => {
    const note = await harness
      .connect()
      .model(SequentialNote as unknown as typeof Note)
      .create({ body: "hi" });

    expect(note.id).toBe("id-1");
  });

  test("a Model's own generateId gets the attribute's name", async () => {
    const note = await harness.connect().model(PrefixedNote).create({ body: "hi" });
    const stored = await harness.connect().model(PrefixedNote).find(note.id);

    expect(stored.id).toMatch(/^id_[0-9a-f-]{36}$/);
  });

  test("a bulk insert generates ids for the rows that leave them out", async () => {
    await harness
      .connect()
      .model(Note)
      .insertAll([{ body: "a" }, { body: "b" }]);

    const ids = await harness.connect().model(Note).pluck("id");
    expect(ids).toHaveLength(2);
    for (const id of ids) expect(id).toMatch(uuid);
    expect(new Set(ids).size).toBe(2);
  });

  test("an upsert that matches an existing row keeps that row's id", async () => {
    const notebooks = harness.connect().model(Notebook);
    const existing = await notebooks.create({ slug: "ideas", title: "Ideas" });

    await notebooks.upsert({ slug: "ideas", title: "Better ideas" }, { uniqueBy: "slug" });

    expect(await notebooks.pluck("id", "title")).toEqual([[existing.id, "Better ideas"]]);
  });

  test("a given id is kept", async () => {
    const note = await harness.connect().model(Note).create({ id: "mine", body: "hi" });

    expect(note.id).toBe("mine");
  });

  test("a generateId that returns something other than a string throws TypeError", () => {
    expect(() => harness.connect().model(NumberedNote).build({ body: "hi" })).toThrow(TypeError);
  });

  test("an owner and the records built through it are written in one batch, atomically", async () => {
    await harness.exec("INSERT INTO notes (id, body) VALUES ('taken', 'x')");
    const notebook = harness.connect().model(Notebook).build({ title: "Ideas" });
    notebook.notes().build({ body: "first" });
    notebook.notes().build({ id: "taken", body: "clash" });

    await expect(notebook.save()).rejects.toThrow(RecordNotUnique);

    expect(await harness.connect().model(Notebook).count()).toBe(0);
    expect(await harness.connect().model(Note).pluck("id")).toEqual(["taken"]);
  });

  describe("declaring one", () => {
    test("alongside a default is an InvalidModel", () => {
      class Both extends Model.define({
        // @ts-expect-error a compile error too; this checks plain JavaScript
        id: { type: "string", null: false, generateId: true, default: () => "x" },
      }) {
        static override table = "notes";
      }

      expect(() => harness.connect().model(Both)).toThrow(
        new InvalidModel("Both.id has both generateId and a default; keep one"),
      );
    });

    test("on an attribute that isn't a string is an InvalidModel", () => {
      class Counted extends Model.define({
        // @ts-expect-error a compile error too; this checks plain JavaScript
        id: { type: "integer", null: false, generateId: true },
      }) {
        static override table = "notes";
      }

      expect(() => harness.connect().model(Counted)).toThrow(
        new InvalidModel(
          'Counted.id is "integer", so it can\'t have generateId: generated ids are strings',
        ),
      );
    });
  });

  describe("overriding one in a generated Model's static attributes", () => {
    /** A generated Model's attributes as a new record has them (its types aren't generated here). */
    const built = (model: object) =>
      harness
        .connect()
        .model(model as typeof Note)
        .build()
        .attributes();

    test("a default replaces generateId", () => {
      class Given extends ApplicationRecord {
        static override table = "notebooks";
        static override attributes = { id: { default: () => "fixed" } } as const;
      }

      expect(built(Given).id).toBe("fixed");
    });

    test("generateId: false turns it off", () => {
      class Plain extends ApplicationRecord {
        static override table = "notebooks";
        static override attributes = { id: { generateId: false } } as const;
      }

      expect(built(Plain).id).toBeNull();
    });

    test("changing the type drops it", () => {
      class Retyped extends ApplicationRecord {
        static override table = "notebooks";
        static override attributes = { id: "integer" } as const;
      }

      expect(built(Retyped).id).toBeNull();
    });

    test("generateId: true turns it on for a string attribute", () => {
      class Titled extends ApplicationRecord {
        static override table = "notebooks";
        static override attributes = { title: { generateId: true } } as const;
      }

      expect(built(Titled).title).toMatch(uuid);
    });

    test("generateId: false leaves a default alone", () => {
      class Colored extends ApplicationRecord {
        static override table = "notebooks";
        static override attributes = { color: { generateId: false } } as const;
      }

      expect(built(Colored).color).toBe("blue");
    });

    test("a bad one is a compile error, and an InvalidModel when used", () => {
      // @ts-expect-error generateId and a default can't go together
      class Doubled extends ApplicationRecord {
        static override table = "notebooks";
        static override attributes = { id: { generateId: true, default: () => "x" } } as const;
      }
      // @ts-expect-error an integer has no generated id
      class Counted extends ApplicationRecord {
        static override table = "notebooks";
        static override attributes = { id: { type: "integer", generateId: true } } as const;
      }

      expect(() => built(Doubled)).toThrow(
        new InvalidModel("Doubled.id has both generateId and a default; keep one"),
      );
      expect(() => built(Counted)).toThrow(
        new InvalidModel(
          'Counted.id is "integer", so it can\'t have generateId: generated ids are strings',
        ),
      );
    });
  });
});
