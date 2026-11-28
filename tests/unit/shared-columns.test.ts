// Each column has one attribute (#575): `Model.define` refuses two stored attributes on one
// column, which an alias gives a second name instead. These tests need no database.
import { describe, expect, test } from "vite-plus/test";
import { InvalidModel, Model } from "../../packages/arbor/src/index.ts";

describe("two attributes on one column", () => {
  test("are refused when one names the other's column", () => {
    const defining = () =>
      Model.define({
        id: { type: "integer", null: false },
        legacyId: { type: "integer", column: "id" },
      });
    expect(defining).toThrow(InvalidModel);
    expect(defining).toThrow(
      `legacyId's column, id, is id's too; to give it a second name, declare legacyId: { aliasOf: "id" }`,
    );
  });

  test("are refused when their names map to one column", () => {
    const defining = () => Model.define({ userId: "integer", userID: "integer" });
    expect(defining).toThrow(
      `userID's column, user_id, is userId's too; to give it a second name, declare userID: { aliasOf: "userId" }`,
    );
  });

  test("are accepted as an attribute and its alias", () => {
    const Post = Model.define({ id: "integer", title: "string", name: { aliasOf: "title" } });
    expect([...Post.attributeDefinitions.keys()]).toEqual(["id", "title"]);
  });

  test("leave virtual attributes out, which have no column", () => {
    const Signup = Model.define({
      id: "integer",
      terms: { type: "boolean", virtual: true },
      newsletter: { type: "boolean", virtual: true },
    });
    expect([...Signup.attributeDefinitions.keys()]).toEqual(["id", "terms", "newsletter"]);
  });
});
