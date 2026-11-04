import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { belongsTo, hasMany, InvalidModel, Model } from "../../packages/active-record/src/index.ts";
import { openHarness, type Harness } from "../support/harness.ts";

// Fresh Models used by no other test: Entry and Remark are only ever reached through includes.
class Owner extends Model.define({ id: { type: "integer", null: false }, email: "string" }) {
  static table = "users";
  entries = hasMany(Entry, { foreignKey: "userId" });
}

class Entry extends Model.define({
  id: { type: "integer", null: false },
  userId: "integer",
  title: "string",
}) {
  static table = "posts";
  owner = belongsTo(Owner, { foreignKey: "userId" });
  remarks = hasMany(Remark, { foreignKey: "postId" });
}

class Remark extends Model.define({
  id: { type: "integer", null: false },
  postId: "integer",
  body: "string",
}) {
  static table = "comments";
}

describe("Models reached only through includes", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await openHarness();
    await harness.exec("INSERT INTO users (id, email) VALUES (1, 'a@example.com')");
    await harness.exec("INSERT INTO posts (id, user_id, title) VALUES (10, 1, 'First')");
    await harness.exec("INSERT INTO comments (id, post_id, body) VALUES (1, 10, 'Nice')");
  });
  afterAll(() => harness.dispose());

  test("get their association methods, lazy and preloaded", async () => {
    const [owner] = await harness.connect().model(Owner).includes({ entries: "remarks" }).toArray();
    const [entry] = owner!.loaded("entries");

    expect((await entry!.owner())?.email).toBe("a@example.com");
    expect(entry!.loaded("remarks").map((remark) => remark.body)).toEqual(["Nice"]);
  });

  test("have their declarations checked", () => {
    class Broken extends Model.define({ id: "integer", userId: "integer" }) {
      static table = "posts";
      owner = belongsTo(Owner, { foreignKey: "ownerId" });
    }
    class Root extends Model.define({ id: "integer" }) {
      static table = "users";
      broken = hasMany(Broken, { foreignKey: "userId" });
    }

    expect(() => harness.connect().model(Root).includes("broken")).toThrow(InvalidModel);
  });
});
