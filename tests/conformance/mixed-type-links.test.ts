import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { belongsTo, hasMany, Model } from "../../packages/arbor/src/index.ts";
import { openHarness, type Harness } from "../support/harness.ts";

// A topic, whose integer key a reply's text body may hold: a mixed-type link (#596).
class Topic extends Model.define({ id: { type: "integer", null: false } }) {
  static table = "topics";

  replies = hasMany(Reply, { foreignKey: "topicId" });
  repliesByBody = hasMany(Reply, { foreignKey: "body" });
  // Through a same-type link, then the mixed-type link from each reply's body.
  bodyTopics = hasMany(Topic, { through: "replies", source: "topicByBody" });
}

class Reply extends Model.define({
  id: { type: "integer", null: false },
  topicId: "integer",
  body: { type: "string", null: false },
}) {
  static table = "replies";

  topic = belongsTo(Topic, { foreignKey: "topicId", optional: true });
  topicByBody = belongsTo(Topic, { foreignKey: "body", optional: true });
}

// A reply counted on the topic whose digits its body holds.
class CountedReply extends Model.define({
  id: { type: "integer", null: false },
  body: { type: "string", null: false },
}) {
  static table = "replies";

  topic = belongsTo(CountedTopic, {
    foreignKey: "body",
    optional: true,
    counterCache: "repliesCount",
  });
}

class CountedTopic extends Model.define({
  id: { type: "integer", null: false },
  repliesCount: "integer",
}) {
  static table = "topics";
}

// A mixed-type link compares its keys as text, so text that isn't the integer's own digits
// ('09', ' 9') links to no integer, from either side, however it's read (#596).
describe("a mixed-type link", () => {
  let harness: Harness;
  const db = () => harness.connect();

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.reset("replies", "topics");
    await harness.exec("INSERT INTO topics (id) VALUES (1), (2), (9)");
    await harness.exec(
      "INSERT INTO replies (id, topic_id, body) VALUES (1, 1, '2'), (2, 2, '9'), (3, 9, '09'), (4, 1, ' 9')",
    );
  });

  test("a join from the integer key finds the text that holds its digits", async () => {
    const ids = await db().model(Topic).joins("repliesByBody").order({ id: "asc" }).pluck("id");

    expect(ids).toEqual([2, 9]);
  });

  test("a join from the text finds the integer key whose digits it holds", async () => {
    const ids = await db().model(Reply).joins("topicByBody").order({ id: "asc" }).pluck("id");

    expect(ids).toEqual([1, 2]);
  });

  test("a through read reaches the integer keys its text holds the digits of", async () => {
    const [first, , ninth] = await db().model(Topic).order({ id: "asc" }).toArray();

    expect(await first!.bodyTopics().pluck("id")).toEqual([2]);
    expect(await ninth!.bodyTopics().pluck("id")).toEqual([]);
  });

  test("a through preload reaches the integer keys its text holds the digits of", async () => {
    const topics = await db().model(Topic).includes("bodyTopics").order({ id: "asc" }).toArray();

    const reached = topics.map((topic) => topic.loaded("bodyTopics").map(({ id }) => id));
    expect(reached).toEqual([[2], [9], []]);
  });

  test("a lazy read finds the integer key only for text that holds its digits", async () => {
    const replies = await db().model(Reply).order({ id: "asc" }).toArray();

    const topics = await Promise.all(replies.map((reply) => reply.topicByBody()));
    expect(topics.map((topic) => topic?.id ?? null)).toEqual([2, 9, null, null]);
  });

  test("a preload finds the integer key only for text that holds its digits", async () => {
    const replies = await db().model(Reply).includes("topicByBody").order({ id: "asc" }).toArray();

    const topics = replies.map((reply) => reply.loaded("topicByBody")?.id ?? null);
    expect(topics).toEqual([2, 9, null, null]);
  });

  test("a hasMany preload finds the text that holds the integer key's digits", async () => {
    const topics = await db().model(Topic).includes("repliesByBody").order({ id: "asc" }).toArray();

    const replies = topics.map((topic) => topic.loaded("repliesByBody").map(({ id }) => id));
    expect(replies).toEqual([[], [1], [2]]);
  });
});

// A counter cache over a mixed-type link counts by the key its record last saved, cast as the
// link compares it, rather than through its stored row (#596).
describe("a counter cache over a mixed-type link", () => {
  let harness: Harness;
  const db = () => harness.connect();
  const counts = async () =>
    (await db().model(CountedTopic).order({ id: "asc" }).toArray()).map(
      (topic) => topic.repliesCount,
    );

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.reset("replies", "topics");
    await harness.exec("INSERT INTO topics (id, replies_count) VALUES (1, 0), (2, 0), (9, 0)");
  });

  test("a reply counts in and out of the topic whose digits its body holds", async () => {
    const reply = await db().model(CountedReply).create({ id: 1, body: "2" });
    expect(await counts()).toEqual([0, 1, 0]);

    await reply.update({ body: "9" });
    expect(await counts()).toEqual([0, 0, 1]);

    await reply.destroy();
    expect(await counts()).toEqual([0, 0, 0]);
  });

  test("a body that isn't a topic's digits counts in and out of no topic", async () => {
    const reply = await db().model(CountedReply).create({ id: 1, body: "09" });
    expect(await counts()).toEqual([0, 0, 0]);

    await reply.update({ body: " 9" });
    expect(await counts()).toEqual([0, 0, 0]);

    await reply.destroy();
    expect(await counts()).toEqual([0, 0, 0]);
  });

  test("a reply whose row is already gone counts out of nothing (guard)", async () => {
    const reply = await db().model(CountedReply).create({ id: 1, body: "2" });
    await harness.exec("DELETE FROM replies WHERE id = 1");

    await reply.destroy();

    expect(await counts()).toEqual([0, 1, 0]);
  });

  test("a stale reply counts out of the topic its last-saved body names", async () => {
    const reply = await db().model(CountedReply).create({ id: 1, body: "2" });
    await harness.exec("UPDATE replies SET body = '9' WHERE id = 1");

    await reply.destroy();

    expect(await counts()).toEqual([0, 0, 0]);
  });
});
