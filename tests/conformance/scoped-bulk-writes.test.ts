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
}

// A bulk write takes its Relation's equality values over the ones it's given, as Rails'
// insert_all merges scope_for_create into each row (#470).
describe("a bulk write through a Relation's conditions", () => {
  let harness: Harness;
  const db = () => harness.connect();
  const posts = () => harness.exec("SELECT id, user_id, title FROM posts ORDER BY id");

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.reset("posts", "users");
    await harness.exec(
      "INSERT INTO users (id, email) VALUES (1, 'a@example.com'), (2, 'b@example.com')",
    );
  });

  test("insert stores the condition's value over the one given", async () => {
    await db().model(Post).where({ userId: 1 }).insert({ id: 1, title: "Hi", userId: 2 });

    expect(await posts()).toEqual([{ id: 1, user_id: 1, title: "Hi" }]);
  });
});
