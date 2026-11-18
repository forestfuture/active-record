import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  belongsTo,
  hasMany,
  InvalidModel,
  Model,
  RecordNotFound,
  UnknownAssociation,
  withDatabase,
} from "../../packages/active-record/src/index.ts";
import type { QueryEvent } from "../../packages/active-record/src/executor.ts";
import { openHarness, type Harness } from "../support/harness.ts";
import { statementKinds } from "../support/statement-kinds.ts";

class Topic extends Model.define({
  id: { type: "integer", null: false },
  title: "string",
  repliesCount: "integer",
  replyTally: "integer",
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
  topic = belongsTo(Topic, { counterCache: true, optional: true });
}

/** A reply counted in the topic's attribute it names. */
class TalliedReply extends Model.define({
  id: { type: "integer", null: false },
  topicId: "integer",
  body: { type: "string", null: false },
}) {
  static table = "replies";
  topic = belongsTo(Topic, { counterCache: "replyTally" });
}

describe("counter caches", () => {
  let harness: Harness;
  const db = () => harness.connect();
  const repliesCount = async (id: number) =>
    Number((await harness.exec("SELECT replies_count AS n FROM topics WHERE id = ?", [id]))[0]?.n);
  const replyTally = async (id: number) =>
    (await harness.exec("SELECT reply_tally AS n FROM topics WHERE id = ?", [id]))[0]?.n;

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

  describe("changing a record's foreign key", () => {
    beforeEach(async () => {
      await harness.exec("UPDATE topics SET replies_count = 1 WHERE id = 1");
      await harness.exec("INSERT INTO replies (id, topic_id, body) VALUES (1, 1, 'a')");
    });

    test("moves the count from the old target to the new one", async () => {
      const reply = await db().model(Reply).find(1);

      reply.topicId = 2;
      await reply.save();

      expect([await repliesCount(1), await repliesCount(2)]).toEqual([0, 1]);
    });

    test("setting the association to another record moves the count", async () => {
      const reply = await db().model(Reply).find(1);

      reply.topic.set(await db().model(Topic).find(2));
      await reply.save();

      expect([await repliesCount(1), await repliesCount(2)]).toEqual([0, 1]);
    });

    test("to null counts the record out, and back counts it in", async () => {
      const reply = await db().model(Reply).find(1);

      reply.topicId = null;
      await reply.save();
      expect(await repliesCount(1)).toBe(0);

      reply.topicId = 1;
      await reply.save();
      expect(await repliesCount(1)).toBe(1);
    });

    test("saving other changes leaves the counter alone", async () => {
      const reply = await db().model(Reply).find(1);

      reply.body = "edited";
      await reply.save();

      expect(await repliesCount(1)).toBe(1);
    });
  });

  describe("a loaded target", () => {
    test("created through its hasMany counts the record in memory, as stored", async () => {
      const topic = await db().model(Topic).find(1);

      await topic.replies().create({ body: "first" });

      expect(topic.repliesCount).toBe(1);
      expect(topic.changes()).toEqual({});
    });

    test("set as the record's target counts the record in on save", async () => {
      const [one, two] = await db().model(Topic).order({ id: "asc" }).toArray();
      const reply = await db().model(Reply).create({ topicId: 1, body: "a" });

      reply.topic.set(two!);
      await reply.save();

      expect([one!.repliesCount, two!.repliesCount]).toEqual([0, 1]);
      expect(two!.changes()).toEqual({});
    });

    test("loaded by the record counts it out when it's destroyed", async () => {
      await harness.exec("UPDATE topics SET replies_count = 1 WHERE id = 1");
      await harness.exec("INSERT INTO replies (id, topic_id, body) VALUES (1, 1, 'a')");
      const reply = await db().model(Reply).find(1);
      const topic = (await reply.topic())!;

      await reply.destroy();

      expect(topic.repliesCount).toBe(0);
      expect(topic.changes()).toEqual({});
    });
  });

  describe("removing records through the owner's hasMany", () => {
    beforeEach(async () => {
      await harness.exec("UPDATE topics SET replies_count = 3 WHERE id = 1");
      await harness.exec(
        "INSERT INTO replies (id, topic_id, body) VALUES (1, 1, 'a'), (2, 1, 'b'), (3, 1, 'c')",
      );
    });

    test("deleteAll() on the association counts out the rows it removes", async () => {
      const topic = await db().model(Topic).find(1);

      expect(await topic.replies().deleteAll()).toBe(3);

      expect(await repliesCount(1)).toBe(0);
      expect(topic.repliesCount).toBe(0);
      expect(topic.changes()).toEqual({});
    });

    test("clear() counts out the rows it removes", async () => {
      const topic = await db().model(Topic).find(1);

      await topic.replies().clear();

      expect([await repliesCount(1), topic.repliesCount]).toEqual([0, 0]);
    });

    test("delete(records) counts out only those records", async () => {
      const topic = await db().model(Topic).find(1);
      const [first, second] = await topic.replies().toArray();

      await topic.replies().delete(first!, second!);

      expect([await repliesCount(1), topic.repliesCount]).toEqual([1, 1]);
    });

    test("a Relation narrowed from it deletes without counting, as in Rails", async () => {
      const topic = await db().model(Topic).find(1);

      await topic.replies().where({ body: "a" }).deleteAll();

      expect(await repliesCount(1)).toBe(3);
    });
  });

  describe("how many records the owner's hasMany has", () => {
    // The counter says 5 while 3 rows point at the topic, so a count read from it shows.
    beforeEach(async () => {
      await harness.exec("UPDATE topics SET replies_count = 5 WHERE id = 1");
      await harness.exec(
        "INSERT INTO replies (id, topic_id, body) VALUES (1, 1, 'a'), (2, 1, 'b'), (3, 1, 'c')",
      );
    });

    test("size() reads the counter, without a query, and adds built records", async () => {
      const events: QueryEvent[] = [];
      const topic = await harness
        .connect({ onQuery: (event) => events.push(event) })
        .model(Topic)
        .find(1);
      events.length = 0;

      expect(await topic.replies().size()).toBe(5);
      topic.replies().build({ body: "d" });
      expect(await topic.replies().size()).toBe(6);
      expect(events).toEqual([]);
    });

    test("isEmpty() and hasAny() read the counter", async () => {
      await harness.exec("UPDATE topics SET replies_count = 0 WHERE id = 1");
      const topic = await db().model(Topic).find(1);

      expect(await topic.replies().isEmpty()).toBe(true);
      expect(await topic.replies().hasAny()).toBe(false);
    });

    test("count(), a loaded collection and a narrowed Relation count the rows", async () => {
      const topic = await db().model(Topic).find(1);

      expect(await topic.replies().count()).toBe(3);
      expect(await topic.replies().where({ body: "a" }).size()).toBe(1);
      await topic.replies().toArray();
      expect(await topic.replies().size()).toBe(3);
    });
  });

  describe("resetCounters", () => {
    beforeEach(async () => {
      await harness.exec("UPDATE topics SET replies_count = 9, reply_tally = NULL");
      await harness.exec(
        "INSERT INTO replies (id, topic_id, body) VALUES (1, 1, 'a'), (2, 1, 'b'), (3, 2, 'c')",
      );
    });

    test("sets an owner's counter to how many records its hasMany has, in one write", async () => {
      const events: QueryEvent[] = [];
      const counted = harness.connect({ onQuery: (event) => events.push(event) });

      await withDatabase(counted, () => Topic.resetCounters(1, "replies"));

      expect([await repliesCount(1), await repliesCount(2)]).toEqual([2, 9]);
      expect(statementKinds(events)).toEqual(["SELECT", "UPDATE"]);
    });

    test("an owner that isn't there is RecordNotFound, as find's", async () => {
      await expect(withDatabase(db(), () => Topic.resetCounters(7, "replies"))).rejects.toThrow(
        RecordNotFound,
      );
    });

    test("a hasMany whose records keep no counter cache is a TypeError", async () => {
      class Untallied extends Model.define({ id: { type: "integer", null: false } }) {
        static table = "topics";
        others = hasMany(Topic, { foreignKey: "id" });
      }

      await expect(withDatabase(db(), () => Untallied.resetCounters(1, "others"))).rejects.toThrow(
        new TypeError('Untallied.resetCounters: "others" has no counter cache on Untallied'),
      );
      await expect(
        // @ts-expect-error resetCounters takes a hasMany's name
        withDatabase(db(), () => Untallied.resetCounters(1, "missing")),
      ).rejects.toThrow(UnknownAssociation);
    });
  });

  describe("an attribute named by counterCache", () => {
    test("is counted instead, from null", async () => {
      const reply = await db().model(TalliedReply).create({ topicId: 1, body: "first" });
      await db().model(TalliedReply).create({ topicId: 1, body: "second" });
      expect(Number(await replyTally(1))).toBe(2);

      await reply.destroy();

      expect(Number(await replyTally(1))).toBe(1);
      expect(await repliesCount(1)).toBe(0);
    });

    test("must be the target's attribute: InvalidModel at first use", () => {
      class Untallied extends Model.define({
        id: { type: "integer", null: false },
        topicId: "integer",
      }) {
        static table = "replies";
        // @ts-expect-error counterCache names one of the target's attributes
        topic = belongsTo(Topic, { counterCache: "missingCount" });
      }

      expect(() => db().model(Untallied).build()).toThrow(
        new InvalidModel(
          'Untallied association "topic": Topic has no attribute "missingCount" (check counterCache)',
        ),
      );
    });

    test("must be the target's attribute when counterCache: true infers it", () => {
      class Note extends Model.define({
        id: { type: "integer", null: false },
        topicId: "integer",
      }) {
        static table = "replies";
        topic = belongsTo(Topic, { counterCache: true });
      }

      expect(() => db().model(Note).build()).toThrow(
        new InvalidModel(
          'Note association "topic": Topic has no attribute "notesCount" (counterCache: true infers it from Note; declare it, or name another)',
        ),
      );
    });
  });

  test("only a belongsTo keeps a counter cache: InvalidModel on another", () => {
    class Counting extends Model.define({ id: { type: "integer", null: false } }) {
      static table = "topics";
      // @ts-expect-error a hasMany takes no counterCache
      replies = hasMany(Reply, { foreignKey: "topicId", counterCache: true });
    }

    expect(() => db().model(Counting).build()).toThrow(
      new InvalidModel('Counting association "replies": only a belongsTo keeps a counter cache'),
    );
  });

  test("counterCache takes true or an attribute's name", () => {
    class Miscounted extends Model.define({
      id: { type: "integer", null: false },
      topicId: "integer",
    }) {
      static table = "replies";
      topic = belongsTo(Topic, { counterCache: false as never });
    }

    expect(() => db().model(Miscounted).build()).toThrow(
      new InvalidModel(
        'Miscounted association "topic": counterCache takes true or the name of Topic\'s attribute',
      ),
    );
  });
});
