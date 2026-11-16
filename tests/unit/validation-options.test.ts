import { describe, expect, test } from "vite-plus/test";
import { Model, type AssociatedValidationOptions } from "../../packages/active-record/src/index.ts";

describe("validation options' types", () => {
  test("unless receives the Model's record", () => {
    class Note extends Model.define({ id: "integer", body: "string" }) {
      static table = "notes";
      static {
        this.validates("body", { presence: true, unless: (note) => note.body === "" });
        // @ts-expect-error "title" isn't one of Note's attributes
        this.validates("body", { presence: true, unless: (note) => note.title === "" });
      }
    }

    expect(Note.name).toBe("Note");
  });

  test("strict takes true or an Error class", () => {
    class Note extends Model.define({ id: "integer", body: "string" }) {
      static table = "notes";
      static {
        this.validates("body", { presence: true, strict: true });
        this.validates("body", { presence: true, strict: RangeError });
        // @ts-expect-error a message isn't an Error class
        this.validates("body", { presence: true, strict: "is required" });
        // @ts-expect-error strict is true or an Error class: leave it out to collect errors
        this.validates("body", { presence: true, strict: false });
      }
    }

    expect(Note.name).toBe("Note");
  });

  test("validatesAssociated's options type is exported, typed to the record", () => {
    class Shelf extends Model.define({ id: "integer", label: "string" }) {
      static table = "shelves";
    }
    const options: AssociatedValidationOptions<Shelf> = {
      if: (shelf) => shelf.label !== null,
      message: "need labels",
    };
    // @ts-expect-error validatesAssociated takes no allowNull
    const refused: AssociatedValidationOptions<Shelf> = { allowNull: true };

    expect([options.message, refused]).toHaveLength(2);
  });
});
