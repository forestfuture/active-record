import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { belongsTo, hasMany, Model } from "../../packages/active-record/src/index.ts";
import type { QueryEvent } from "../../packages/active-record/src/executor.ts";
import { openHarness, type Harness } from "../support/harness.ts";
import { statementKinds } from "../support/statement-kinds.ts";

class Topic extends Model.define({
  id: { type: "integer", null: false },
  title: "string",
  repliesCount: "integer",
}) {
  static table = "topics";
  replies = hasMany(Reply);
}

class DestroyingTopic extends Model.define({
  id: { type: "integer", null: false },
  title: "string",
  repliesCount: "integer",
}) {
  static table = "topics";
  replies = hasMany(Reply, { foreignKey: "topicId", dependent: "destroy" });
}

class Reply extends Model.define({
  id: { type: "integer", null: false },
  topicId: "integer",
  body: { type: "string", null: false },
}) {
  static table = "replies";
  topic = belongsTo(Topic, { counterCache: true });
}

describe("counter caches", () => {
  let harness: Harness;
  const db = () => harness.connect();
  const repliesCount = async (id: number) =>
    Number((await harness.exec("SELECT replies_count AS n FROM topics WHERE id = ?", [id]))[0]?.n);

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.reset("replies", "topics");
    await harness.exec(
      "INSERT INTO topics (id, title, replies_count) VALUES (1, 'One', 0), (2, 'Two', 0)",
    );
  });

  test("creating a record increments its target's counter", async () => {
    await db().model(Reply).create({ topicId: 1, body: "first" });
    await db().model(Reply).create({ topicId: 1, body: "second" });

    expect(await repliesCount(1)).toBe(2);
    expect(await repliesCount(2)).toBe(0);
  });

  describe("destroying a record", () => {
    beforeEach(async () => {
      await harness.exec("UPDATE topics SET replies_count = 2 WHERE id = 1");
      await harness.exec(
        "INSERT INTO replies (id, topic_id, body) VALUES (1, 1, 'a'), (2, 1, 'b')",
      );
    });

    test("decrements its target's counter", async () => {
      const reply = await db().model(Reply).find(1);

      await reply.destroy();

      expect(await repliesCount(1)).toBe(1);
    });

    test("leaves the counter alone when its row is already gone", async () => {
      const reply = await db().model(Reply).find(1);
      await harness.exec("DELETE FROM replies WHERE id = 1");

      await reply.destroy();

      expect(await repliesCount(1)).toBe(2);
    });

    test("decrements the target its stored row points at", async () => {
      const reply = await db().model(Reply).find(1);
      await harness.exec("UPDATE replies SET topic_id = 2 WHERE id = 1");
      await harness.exec("UPDATE topics SET replies_count = 1 WHERE id = 2");

      await reply.destroy();

      expect(await repliesCount(1)).toBe(2);
      expect(await repliesCount(2)).toBe(0);
    });

    test("through its target's dependent: destroy leaves the target's counter alone", async () => {
      const events: QueryEvent[] = [];
      const topic = await harness
        .connect({ onQuery: (event) => events.push(event) })
        .model(DestroyingTopic)
        .find(1);
      events.length = 0;

      await topic.destroy();

      // The replies' two DELETEs and the topic's, with no UPDATE of the topic being deleted.
      expect(statementKinds(events).filter((kind) => kind !== "SELECT")).toEqual([
        "DELETE",
        "DELETE",
        "DELETE",
      ]);
    });
  });
});
