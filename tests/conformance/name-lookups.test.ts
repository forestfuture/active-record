import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { UnknownAssociation, UnknownAttribute } from "../../src/index.ts";
import { User } from "../fixtures/models/user.ts";
import { openHarness, type Harness } from "../support/harness.ts";

// Names an app might take from a URL (`?include=`), and that every JavaScript object inherits:
// each is an unknown name, never one of Object's own members (#84).
const inherited = ["constructor", "__proto__", "toString", "hasOwnProperty", "valueOf"];

describe("a name that every object inherits isn't an attribute or association", () => {
  let harness: Harness;
  let user: User;
  const users = () => harness.connect().model(User);

  beforeAll(async () => {
    harness = await openHarness();
    user = await users().create({ id: 1, email: "ada@example.com" });
    await user.update({ email: "ada@lovelace.dev" });
  });
  afterAll(() => harness.dispose());

  // includes checks its names when it's called, as for any name that isn't an association.
  test.each(inherited)("includes(%j) is UnknownAssociation", (name) => {
    expect(() => users().includes(name as never)).toThrow(UnknownAssociation);
  });

  test.each(inherited)(
    "reloadAssociation, loaded and isLoaded(%j) are UnknownAssociation",
    async (name) => {
      await expect(user.reloadAssociation(name as never)).rejects.toThrow(UnknownAssociation);
      expect(() => user.loaded(name as never)).toThrow(UnknownAssociation);
      expect(() => user.isLoaded(name as never)).toThrow(UnknownAssociation);
    },
  );

  test.each(inherited)("the change-tracking methods with %j are UnknownAttribute", (name) => {
    const unknown = name as never;
    expect(() => user.attributeWas(unknown)).toThrow(UnknownAttribute);
    expect(() => user.isAttributeChanged(unknown)).toThrow(UnknownAttribute);
    expect(() => user.willSaveChangeTo(unknown)).toThrow(UnknownAttribute);
    expect(() => user.savedChangeTo(unknown)).toThrow(UnknownAttribute);
    expect(() => user.hasSavedChangeTo(unknown)).toThrow(UnknownAttribute);
    expect(() => user.attributeBeforeLastSave(unknown)).toThrow(UnknownAttribute);
    expect(() => user.restoreAttributes([unknown])).toThrow(UnknownAttribute);
  });

  test("the real names still work", async () => {
    expect(user.savedChangeTo("email")).toEqual(["ada@example.com", "ada@lovelace.dev"]);
    expect(await user.reloadAssociation("posts")).toEqual([]);
  });

  // Guards: these already went through the attributes' Map; nothing may regress (#84).
  test.each(inherited)("nested includes with %j is UnknownAssociation", (name) => {
    expect(() => users().includes({ [name]: "posts" } as never)).toThrow(UnknownAssociation);
    expect(() => users().includes({ posts: name } as never)).toThrow(UnknownAssociation);
  });

  test.each(inherited)(
    "select, pluck, count and order({ … }) with %j are UnknownAttribute",
    async (name) => {
      const unknown = name as never;
      expect(() => users().select(unknown)).toThrow(UnknownAttribute);
      await expect(users().pluck(unknown)).rejects.toThrow(UnknownAttribute);
      await expect(users().count(unknown)).rejects.toThrow(UnknownAttribute);
      expect(() => users().order({ [name]: "asc" } as never)).toThrow(UnknownAttribute);
    },
  );

  // A JSON body can hold an own "__proto__" or "constructor" key.
  test.each(inherited)("a %j key in conditions or attributes is UnknownAttribute", async (name) => {
    const keyed = JSON.parse(`{${JSON.stringify(name)}: 1}`) as never;
    expect(() => users().where(keyed)).toThrow(UnknownAttribute);
    expect(() => users().whereNot(keyed)).toThrow(UnknownAttribute);
    await expect(users().findBy(keyed)).rejects.toThrow(UnknownAttribute);
    await expect(users().exists(keyed)).rejects.toThrow(UnknownAttribute);
    expect(() => users().toUpdateAll(keyed)).toThrow(UnknownAttribute);
    expect(() => users().toInsert(keyed)).toThrow(UnknownAttribute);
    expect(() => users().toUpsert({ id: 1, email: "x" }, { uniqueBy: name as never })).toThrow(
      UnknownAttribute,
    );
    expect(() => users().build(keyed)).toThrow(UnknownAttribute);
    expect(() => user.assign(keyed)).toThrow(UnknownAttribute);
    expect(() => User.permit({}, name as never)).toThrow(UnknownAttribute);
  });
});
