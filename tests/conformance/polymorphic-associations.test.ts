import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { belongsTo, Model } from "../../packages/active-record/src/index.ts";
import type { QueryEvent } from "../../packages/active-record/src/executor.ts";
import { openHarness, type Harness } from "../support/harness.ts";

class Post extends Model.define({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
}) {
  static table = "posts";
}

class Photo extends Model.define({
  id: { type: "integer", null: false },
  title: "string",
}) {
  static table = "photos";
}

class Remark extends Model.define({
  id: { type: "integer", null: false },
  body: "string",
  commentableType: "string",
  commentableId: "integer",
}) {
  static table = "remarks";

  commentable = belongsTo([Post, Photo], { optional: true });
}

describe("polymorphic associations", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.reset("remarks", "photos", "comments", "posts", "profiles", "users");
    await harness.exec("INSERT INTO users (id, email) VALUES (1, 'a@example.com')");
    await harness.exec("INSERT INTO posts (id, user_id, title) VALUES (10, 1, 'First')");
    await harness.exec("INSERT INTO photos (id, title) VALUES (10, 'Sunset')");
    await harness.exec(
      "INSERT INTO remarks (id, body, commentable_type, commentable_id) VALUES (1, 'On a post', 'Post', 10), (2, 'On a photo', 'Photo', 10), (3, 'On nothing', NULL, NULL)",
    );
  });

  describe("reading a polymorphic belongsTo", () => {
    test("loads the record of the Model its type names", async () => {
      const db = harness.connect();
      const [onPost, onPhoto] = await db.model(Remark).order({ id: "asc" }).limit(2).toArray();

      const post = await onPost!.commentable();
      const photo = await onPhoto!.commentable();

      expect(post).toBeInstanceOf(Post);
      expect((post as Post).title).toBe("First");
      expect(photo).toBeInstanceOf(Photo);
      expect((photo as Photo).title).toBe("Sunset");
    });

    test("is null without a query when the type and id are null", async () => {
      const queries: QueryEvent[] = [];
      const db = harness.connect({ onQuery: (event) => queries.push(event) });
      const remark = await db.model(Remark).find(3);
      queries.length = 0;

      expect(await remark.commentable()).toBeNull();
      expect(queries).toHaveLength(0);
    });
  });
});
