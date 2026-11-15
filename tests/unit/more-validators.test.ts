import { describe, expect, test } from "vite-plus/test";
import { Model, type Errors } from "../../packages/active-record/src/index.ts";
import { connect } from "../../packages/active-record/src/adapters/d1/index.ts";

/** Validates `record`, returning its errors as `attribute type: message`. */
async function errorsOf(record: { isValid(): Promise<boolean>; errors: Errors }) {
  await record.isValid();
  return record.errors
    .toArray()
    .map(({ attribute, type, message }) => `${attribute} ${type}: ${message}`);
}

describe("exclusion", () => {
  class Handle extends Model.define({
    id: "integer",
    name: "string",
    slug: "string",
    nick: "string",
  }) {
    static table = "handles";
    static {
      this.validates("name", { exclusion: ["admin", "root"] });
      this.validates("slug", { exclusion: { in: ["new", null] } });
      this.validates("nick", { exclusion: ["admin"], allowNull: true });
    }
  }
  const handles = connect({} as never).model(Handle);

  test("passes a value outside the list, and null unless the list holds it", async () => {
    expect(await errorsOf(handles.build({ name: "ada", slug: "ada", nick: null }))).toEqual([]);
    expect(await errorsOf(handles.build({ name: null, slug: "ada", nick: "ada" }))).toEqual([]);
  });

  test("fails a value in the list as reserved, in either form", async () => {
    const handle = handles.build({ name: "admin", slug: "new", nick: "ada" });

    expect(await errorsOf(handle)).toEqual([
      "name exclusion: is reserved",
      "slug exclusion: is reserved",
    ]);
  });

  test("skips null with allowNull, and fails null when the list holds it", async () => {
    const handle = handles.build({ name: "ada", slug: null, nick: null });

    expect(await errorsOf(handle)).toEqual(["slug exclusion: is reserved"]);
  });
});
