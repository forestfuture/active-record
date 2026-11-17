import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { Comment } from "../fixtures/models/comment.ts";
import type { QueryEvent } from "../../packages/active-record/src/executor.ts";
import { openHarness, type Harness } from "../support/harness.ts";

describe("joins", () => {
  let harness: Harness;
  const queries: QueryEvent[] = [];
  const db = () => harness.connect({ onQuery: (event) => queries.push(event) });

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    queries.length = 0;
    await harness.reset("comments", "posts", "profiles", "users");
    await harness.exec(
      "INSERT INTO users (id, email, role) VALUES (1, 'a@example.com', 'admin'), (2, 'b@example.com', 'guest'), (3, 'c@example.com', 'admin')",
    );
    await harness.exec(
      "INSERT INTO posts (id, user_id, title) VALUES (10, 1, 'A1'), (11, 1, 'A2'), (12, 2, 'B1')",
    );
    await harness.exec(
      "INSERT INTO comments (id, post_id, body) VALUES (100, 10, 'on A1'), (101, 12, 'on B1'), (102, NULL, 'loose')",
    );
  });

  describe("a belongsTo", () => {
    test("finds only the records with a linked record, in one query", async () => {
      const comments = await db().model(Comment).joins("post").order({ id: "asc" }).toArray();

      expect(comments.map((comment) => comment.body)).toEqual(["on A1", "on B1"]);
      expect(queries).toHaveLength(1);
    });

    test("keeps the Model's own conditions and finders to its own columns", async () => {
      const comments = db().model(Comment).joins("post");

      expect((await comments.where({ id: 101 }).first())?.body).toBe("on B1");
      expect((await comments.last())?.body).toBe("on B1");
      expect(await comments.find(100)).toMatchObject({ id: 100, postId: 10 });
    });
  });
});
