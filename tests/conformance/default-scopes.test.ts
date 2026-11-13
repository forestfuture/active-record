import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { Model } from "../../packages/active-record/src/index.ts";
import { openHarness, type Harness } from "../support/harness.ts";

class Post extends Model.define({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
  published: "boolean",
}) {
  static table = "posts";

  static {
    this.defaultScope((q) => q.where({ published: true }));
  }
}

describe("default scopes", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.reset("comments", "posts", "profiles", "users");
    await harness.exec("INSERT INTO users (id, email) VALUES (1, 'a@example.com')");
    await harness.exec(`INSERT INTO posts (id, user_id, title, published) VALUES
           (10, 1, 'Live', 1), (11, 1, 'Draft', 0), (12, 1, 'Also live', 1)`);
  });

  test("narrows every query on the Model", async () => {
    const posts = harness.connect().model(Post);

    expect(await posts.order({ id: "asc" }).pluck("title")).toEqual(["Live", "Also live"]);
    expect(await posts.count()).toBe(2);
    expect(await posts.where({ title: "Draft" }).exists()).toBe(false);
  });
});
