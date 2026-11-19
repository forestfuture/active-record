import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { belongsTo, hasMany, InvalidModel, Model } from "../../packages/active-record/src/index.ts";
import type { QueryEvent } from "../../packages/active-record/src/executor.ts";
import { openHarness, type Harness } from "../support/harness.ts";
import { statementKinds } from "../support/statement-kinds.ts";

class Forum extends Model.define({
  id: { type: "integer", null: false },
  title: "string",
  updatedAt: "datetime",
  lastActivityAt: "datetime",
}) {
  static table = "forums";
}

class Discussion extends Model.define({
  id: { type: "integer", null: false },
  forumId: "integer",
  title: "string",
  updatedAt: "datetime",
  lastMessageAt: "datetime",
}) {
  static table = "discussions";
  forum = belongsTo(Forum, { optional: true });
  messages = hasMany(Message);
}

class Message extends Model.define({
  id: { type: "integer", null: false },
  discussionId: "integer",
  body: "string",
  updatedAt: "datetime",
}) {
  static table = "messages";
  discussion = belongsTo(Discussion, { touch: true, optional: true });
}

/** A forum without timestamps, which `touch: true` has nothing to set on. */
class PlainForum extends Model.define({ id: { type: "integer", null: false }, title: "string" }) {
  static table = "forums";
}

/** What the callbacks below heard, in order. */
const heard: string[] = [];

/** A discussion whose callbacks say when they run. */
class HeardDiscussion extends Model.define({
  id: { type: "integer", null: false },
  title: "string",
  updatedAt: "datetime",
  lastMessageAt: "datetime",
}) {
  static table = "discussions";
  messages = hasMany(HeardMessage, { foreignKey: "discussionId" });
  static {
    this.afterTouch(() => void heard.push("afterTouch"));
    this.afterUpdateCommit(() => void heard.push("afterUpdateCommit"));
    this.afterRollback(() => void heard.push("afterRollback"));
  }
}

/** A message touching its discussion's lastMessageAt too. */
class HeardMessage extends Model.define({
  id: { type: "integer", null: false },
  discussionId: "integer",
  body: "string",
}) {
  static table = "messages";
  discussion = belongsTo(HeardDiscussion, {
    foreignKey: "discussionId",
    touch: "lastMessageAt",
    optional: true,
  });
  static {
    this.afterSave(() => void heard.push("message afterSave"));
    this.afterCommit(() => void heard.push("message afterCommit"));
  }
}

/** A discussion touching its forum's lastActivityAt, as its messages touch it. */
class ActiveDiscussion extends Model.define({
  id: { type: "integer", null: false },
  forumId: "integer",
  updatedAt: "datetime",
}) {
  static table = "discussions";
  forum = belongsTo(Forum, { touch: "lastActivityAt", optional: true });
}

class ActiveMessage extends Model.define({
  id: { type: "integer", null: false },
  discussionId: "integer",
}) {
  static table = "messages";
  discussion = belongsTo(ActiveDiscussion, { foreignKey: "discussionId", touch: true });
}

/** A discussion following up another, which it touches: two can follow up each other. */
class FollowUp extends Model.define({
  id: { type: "integer", null: false },
  forumId: "integer",
  updatedAt: "datetime",
}) {
  static table = "discussions";
  previous = belongsTo(FollowUp, { foreignKey: "forumId", touch: true, optional: true });
}

/** A discussion counting its messages, whose default scope hides archived ones. */
class CountingDiscussion extends Model.define({
  id: { type: "integer", null: false },
  archived: "boolean",
  messagesCount: "integer",
  updatedAt: "datetime",
}) {
  static table = "discussions";
  static {
    this.defaultScope((q) => q.where({ archived: false }));
    this.afterTouch(() => void heard.push("afterTouch"));
    this.afterUpdateCommit(() => void heard.push("afterUpdateCommit"));
  }
}

/** A message counted on its discussion, which it touches with its count. */
class CountedMessage extends Model.define({
  id: { type: "integer", null: false },
  discussionId: "integer",
  body: "string",
}) {
  static table = "messages";
  discussion = belongsTo(CountingDiscussion, {
    foreignKey: "discussionId",
    counterCache: "messagesCount",
    touch: true,
    optional: true,
  });
}

/** A sticker on a discussion or a forum, touching whichever it's on. */
class Sticker extends Model.define({
  id: { type: "integer", null: false },
  stickableType: "string",
  stickableId: "integer",
}) {
  static table = "stickers";
  stickable = belongsTo([Discussion, Forum], { touch: true });
}

/** A discussion touching its forum, with a count and a flag changed straight in the row. */
class TallyDiscussion extends Model.define({
  id: { type: "integer", null: false },
  forumId: "integer",
  archived: "boolean",
  messagesCount: "integer",
}) {
  static table = "discussions";
  forum = belongsTo(Forum, { touch: true, optional: true });
}

/** A discussion destroying its messages with it. */
class ClosingDiscussion extends Model.define({
  id: { type: "integer", null: false },
  updatedAt: "datetime",
}) {
  static table = "discussions";
  messages = hasMany(Message, { foreignKey: "discussionId", dependent: "destroy" });
}

/** A discussion that can be archived, which the scoped belongsTos below don't reach. */
class ArchivableDiscussion extends Model.define({
  id: { type: "integer", null: false },
  archived: "boolean",
  updatedAt: "datetime",
}) {
  static table = "discussions";
}

/** A message whose discussion is read only while it's open. */
class OpenMessage extends Model.define({
  id: { type: "integer", null: false },
  discussionId: "integer",
}) {
  static table = "messages";
  discussion = belongsTo(ArchivableDiscussion, {
    foreignKey: "discussionId",
    touch: true,
    scope: (q) => q.where({ archived: false }),
  });
}

/** A discussion whose default scope hides archived ones. */
class ListedDiscussion extends Model.define({
  id: { type: "integer", null: false },
  archived: "boolean",
  updatedAt: "datetime",
}) {
  static table = "discussions";
  static {
    this.defaultScope((q) => q.where({ archived: false }));
  }
}

class ListedMessage extends Model.define({
  id: { type: "integer", null: false },
  discussionId: "integer",
}) {
  static table = "messages";
  discussion = belongsTo(ListedDiscussion, {
    foreignKey: "discussionId",
    touch: true,
    optional: true,
  });
}

describe("a belongsTo's touch (#353)", () => {
  let harness: Harness;
  const db = () => harness.connect();

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.reset("stickers", "messages", "discussions", "forums");
    await harness.exec(
      "INSERT INTO discussions (id, title, updated_at) VALUES (1, 'One', ?), (2, 'Two', ?)",
      [stale.toISOString(), stale.toISOString()],
    );
  });

  /** A time before every test's writes. */
  const stale = new Date("2020-01-01T00:00:00.000Z");
  const updatedAt = async (id: number) => (await db().model(Discussion).find(id)).updatedAt;
  /** A Database whose statements are recorded in `events`. */
  const recorded = (events: QueryEvent[]) =>
    harness.connect({ onQuery: (event) => void events.push(event) });

  describe("declaring it", () => {
    test("a target without updatedAt touched with true is an InvalidModel at first use", () => {
      class Untimed extends Model.define({
        id: { type: "integer", null: false },
        forumId: "integer",
      }) {
        static table = "discussions";
        forum = belongsTo(PlainForum, { foreignKey: "forumId", touch: true });
      }

      expect(() => db().model(Untimed).build()).toThrow(
        new InvalidModel(
          "Untimed association \"forum\": touch: true sets PlainForum's updatedAt, which it doesn't have (name a datetime attribute)",
        ),
      );
    });

    test("a named attribute that isn't a datetime is an InvalidModel", () => {
      class Misnamed extends Model.define({
        id: { type: "integer", null: false },
        forumId: "integer",
      }) {
        static table = "discussions";
        // Untyped code can name any attribute.
        forum = belongsTo(Forum, { touch: ["lastActivityAt", "title"] as unknown as true });
      }

      expect(() => db().model(Misnamed).build()).toThrow(
        new InvalidModel(
          'Misnamed association "forum": touch takes Forum\'s datetime attributes; "title" isn\'t one',
        ),
      );
    });

    test("a polymorphic belongsTo's every listed Model needs what it touches", () => {
      class Sticker extends Model.define({
        id: { type: "integer", null: false },
        stickableType: "string",
        stickableId: "integer",
      }) {
        static table = "stickers";
        stickable = belongsTo([Discussion, PlainForum], { touch: true });
      }

      expect(() => db().model(Sticker).build()).toThrow(
        new InvalidModel(
          "Sticker association \"stickable\": touch: true sets PlainForum's updatedAt, which it doesn't have (name a datetime attribute)",
        ),
      );
    });

    test("a value that isn't true, a name or a list of names is an InvalidModel", () => {
      class Falsy extends Model.define({
        id: { type: "integer", null: false },
        forumId: "integer",
      }) {
        static table = "discussions";
        forum = belongsTo(Forum, { touch: false as unknown as true });
      }

      expect(() => db().model(Falsy).build()).toThrow(
        new InvalidModel(
          'Falsy association "forum": touch takes true, the name of a datetime attribute of Forum, or a list of them',
        ),
      );
    });

    test("a hasMany's touch is an InvalidModel: only a belongsTo touches", () => {
      class Toucher extends Model.define({ id: { type: "integer", null: false } }) {
        static table = "discussions";
        messages = hasMany(Message, {
          foreignKey: "discussionId",
          ...({ touch: true } as object),
        });
      }

      expect(() => db().model(Toucher).build()).toThrow(
        new InvalidModel(
          'Toucher association "messages": a hasMany takes no touch; only a belongsTo touches',
        ),
      );
    });

    test("true, a datetime attribute, or a list of them, is declared", () => {
      class Named extends Model.define({
        id: { type: "integer", null: false },
        forumId: "integer",
      }) {
        static table = "discussions";
        forum = belongsTo(Forum, { touch: ["lastActivityAt"] });
      }

      expect(db().model(Named).build()).toBeInstanceOf(Named);
      expect(db().model(Message).build()).toBeInstanceOf(Message);
    });
  });

  describe("creating a record", () => {
    test("touches the record it belongs to, loaded, in the same batch", async () => {
      const events: QueryEvent[] = [];
      const discussion = await recorded(events).model(Discussion).find(1);
      events.length = 0;

      await discussion.messages().create({ body: "Hi" });

      expect(statementKinds(events)).toEqual(["INSERT", "UPDATE"]);
      expect(events.map((event) => event.model)).toEqual(["Message", "Discussion"]);
      expect(discussion.updatedAt!.getTime()).toBeGreaterThan(stale.getTime());
      expect(discussion.isChanged()).toBe(false);
      expect(await updatedAt(1)).toEqual(discussion.updatedAt);
      expect(await updatedAt(2)).toEqual(stale);
    });

    test("loads it first when it isn't loaded", async () => {
      const events: QueryEvent[] = [];

      const message = await recorded(events).model(Message).create({ discussionId: 1, body: "Hi" });

      expect(statementKinds(events)).toEqual(["SELECT", "INSERT", "UPDATE"]);
      expect((await updatedAt(1))!.getTime()).toBeGreaterThan(stale.getTime());
      expect((await message.discussion())!.updatedAt).toEqual(await updatedAt(1));
    });

    test("a key that finds no record, or none, touches nothing", async () => {
      const events: QueryEvent[] = [];
      const messages = recorded(events).model(Message);

      await messages.create({ discussionId: 99, body: "Lost" });
      await messages.create({ body: "Alone" });

      expect(statementKinds(events)).toEqual(["SELECT", "INSERT", "INSERT"]);
    });

    test("a new record it belongs to is touched once it's inserted", async () => {
      const events: QueryEvent[] = [];
      const message = recorded(events).model(Message).build({ body: "First" });
      message.discussion.build({ title: "New" });

      await message.saveOrThrow();

      expect(statementKinds(events)).toEqual(["INSERT", "INSERT", "UPDATE"]);
      expect(events.map((event) => event.model)).toEqual(["Discussion", "Message", "Discussion"]);
      expect(events[2]!.params.at(-1)).toBe(message.discussionId);
    });
  });

  describe("updating a record", () => {
    beforeEach(async () => {
      await harness.exec("INSERT INTO messages (id, discussion_id, body) VALUES (1, 1, 'Hi')");
    });

    test("an update that writes touches the record it belongs to", async () => {
      const message = await db().model(Message).find(1);
      message.body = "Edited";

      await message.saveOrThrow();

      expect((await updatedAt(1))!.getTime()).toBeGreaterThan(stale.getTime());
      expect(await updatedAt(2)).toEqual(stale);
    });

    test("a save with nothing to write touches nothing", async () => {
      const events: QueryEvent[] = [];
      const message = await recorded(events).model(Message).find(1);
      events.length = 0;

      await message.saveOrThrow();

      expect(events).toEqual([]);
      expect(await updatedAt(1)).toEqual(stale);
    });

    test("moving it to another record touches both, the old one found by its stored key", async () => {
      const message = await db().model(Message).find(1);
      message.discussionId = 2;

      await message.saveOrThrow();

      expect((await updatedAt(1))!.getTime()).toBeGreaterThan(stale.getTime());
      expect(await updatedAt(2)).toEqual(await updatedAt(1));
    });

    test("touch() with an unsaved key change touches both, the old one by the row's key", async () => {
      const message = await db().model(Message).find(1);
      message.discussionId = 2;

      await message.touch();

      expect((await updatedAt(1))!.getTime()).toBeGreaterThan(stale.getTime());
      expect(await updatedAt(2)).toEqual(message.updatedAt);
    });

    test("moving it to none touches the old one", async () => {
      const message = await db().model(Message).find(1);
      message.discussionId = null;

      await message.saveOrThrow();

      expect((await updatedAt(1))!.getTime()).toBeGreaterThan(stale.getTime());
    });
  });

  describe("the records it reaches", () => {
    beforeEach(async () => {
      await harness.exec("UPDATE discussions SET archived = 1 WHERE id = 1");
      await harness.exec("INSERT INTO messages (id, discussion_id, body) VALUES (1, 1, 'Hi')");
    });

    test("are found as the association reads them: its scope hides the old one", async () => {
      const message = await db().model(OpenMessage).find(1);
      message.discussionId = 2;

      await message.saveOrThrow();

      expect(await updatedAt(1)).toEqual(stale);
      expect((await updatedAt(2))!.getTime()).toBeGreaterThan(stale.getTime());
    });

    test("are found through the target's default scope, which can hide the new one", async () => {
      const message = await db().model(ListedMessage).find(1);
      message.discussionId = 2;
      await message.saveOrThrow();
      message.discussionId = 1;

      await message.saveOrThrow();

      expect(await updatedAt(1)).toEqual(stale);
    });
  });

  describe("destroying a record", () => {
    beforeEach(async () => {
      await harness.exec("INSERT INTO messages (id, discussion_id, body) VALUES (1, 1, 'Hi')");
    });

    test("touches the record it belongs to, in the same batch", async () => {
      const events: QueryEvent[] = [];
      const message = await recorded(events).model(Message).find(1);
      events.length = 0;

      await message.destroyOrThrow();

      expect(statementKinds(events)).toEqual(["SELECT", "DELETE", "UPDATE"]);
      expect((await updatedAt(1))!.getTime()).toBeGreaterThan(stale.getTime());
    });

    test("with an unsaved key change touches both: the row's record and the new one", async () => {
      const message = await db().model(Message).find(1);
      message.discussionId = 2;

      await message.destroyOrThrow();

      expect((await updatedAt(1))!.getTime()).toBeGreaterThan(stale.getTime());
      expect(await updatedAt(2)).toEqual(await updatedAt(1));
    });

    test("through the record's dependent: destroy doesn't touch that record", async () => {
      const events: QueryEvent[] = [];
      const discussion = await recorded(events).model(ClosingDiscussion).find(1);
      events.length = 0;

      await discussion.destroyOrThrow();

      expect(statementKinds(events)).toEqual(["SELECT", "DELETE", "DELETE"]);
    });

    test("a record that was never saved touches nothing", async () => {
      const events: QueryEvent[] = [];
      const message = recorded(events).model(Message).build({ discussionId: 1 });

      await message.destroyOrThrow();

      expect(events).toEqual([]);
    });
  });

  describe("what it sets and runs", () => {
    beforeEach(() => {
      heard.length = 0;
    });

    test("a named attribute is set with updatedAt, both to one time", async () => {
      const discussion = await db().model(HeardDiscussion).find(1);

      await discussion.messages().create({ body: "Hi" });

      const row = await db().model(HeardDiscussion).find(1);
      expect(row.lastMessageAt!.getTime()).toBeGreaterThan(stale.getTime());
      expect(row.updatedAt).toEqual(row.lastMessageAt);
      expect(discussion.lastMessageAt).toEqual(row.lastMessageAt);
    });

    test("a list names several", async () => {
      class Listing extends Model.define({
        id: { type: "integer", null: false },
        discussionId: "integer",
      }) {
        static table = "messages";
        discussion = belongsTo(Discussion, { touch: ["lastMessageAt"] });
      }

      await db().model(Listing).create({ discussionId: 1 });

      const row = await db().model(Discussion).find(1);
      expect(row.lastMessageAt!.getTime()).toBeGreaterThan(stale.getTime());
      expect(row.updatedAt).toEqual(row.lastMessageAt);
    });

    test("the touched record runs afterTouch, then its update commit callbacks", async () => {
      await db().model(HeardMessage).create({ discussionId: 1, body: "Hi" });

      expect(heard).toEqual([
        "message afterSave",
        "afterTouch",
        "message afterCommit",
        "afterUpdateCommit",
      ]);
    });

    test("one saved in the same write runs its commit callbacks once", async () => {
      const discussion = await db().model(HeardDiscussion).find(1);
      discussion.messages().build({ body: "Hi" });

      await discussion.saveOrThrow();

      expect(heard.filter((each) => each === "afterUpdateCommit")).toEqual(["afterUpdateCommit"]);
      expect(heard).toContain("afterTouch");
      expect((await updatedAt(1))!.getTime()).toBeGreaterThan(stale.getTime());
    });

    test("a write the database refuses leaves the record as it was, and runs afterRollback", async () => {
      await harness.exec("INSERT INTO messages (id, discussion_id, body) VALUES (1, 1, 'Hi')");
      const discussion = await db().model(HeardDiscussion).find(1);

      await expect(discussion.messages().create({ id: 1, body: "Again" })).rejects.toThrow();

      expect(discussion.updatedAt).toEqual(stale);
      expect(discussion.isChanged()).toBe(false);
      expect(heard).toEqual(["afterRollback"]);
      expect(await updatedAt(1)).toEqual(stale);
    });
  });

  describe("touching in turn", () => {
    beforeEach(async () => {
      await harness.exec("INSERT INTO forums (id, title, updated_at) VALUES (1, 'General', ?)", [
        stale.toISOString(),
      ]);
      await harness.exec("UPDATE discussions SET forum_id = 1 WHERE id = 1");
    });

    test("a touched record touches the records its own touch reaches", async () => {
      const events: QueryEvent[] = [];

      await recorded(events).model(ActiveMessage).create({ discussionId: 1 });

      expect(statementKinds(events)).toEqual(["SELECT", "SELECT", "INSERT", "UPDATE", "UPDATE"]);
      const forum = await db().model(Forum).find(1);
      expect(forum.lastActivityAt!.getTime()).toBeGreaterThan(stale.getTime());
      expect(forum.updatedAt).toEqual(await updatedAt(1));
    });

    test("touch() touches the records its belongsTos' touch reaches", async () => {
      const discussion = await db().model(ActiveDiscussion).find(1);

      await discussion.touch();

      const forum = await db().model(Forum).find(1);
      expect(forum.lastActivityAt!.getTime()).toBeGreaterThan(stale.getTime());
      expect(forum.updatedAt).toEqual(discussion.updatedAt);
    });

    test("each record is touched once, when they touch each other", async () => {
      await harness.exec("UPDATE discussions SET forum_id = 2 WHERE id = 1");
      await harness.exec("UPDATE discussions SET forum_id = 1 WHERE id = 2");
      const events: QueryEvent[] = [];
      const followUp = await recorded(events).model(FollowUp).find(1);
      events.length = 0;

      await followUp.touch();

      const writes = statementKinds(events).filter((kind) => kind !== "SELECT");
      expect(writes).toEqual(["UPDATE", "UPDATE"]);
      expect(await updatedAt(2)).toEqual(followUp.updatedAt);
    });
  });

  describe("several records in one write", () => {
    beforeEach(() => {
      heard.length = 0;
    });

    test("a record the batch saves after the one touching it runs its commit callbacks once", async () => {
      const database = db();
      const discussion = await database.model(HeardDiscussion).find(1);
      const message = database.model(HeardMessage).build({ discussionId: 1, body: "Hi" });
      discussion.title = "Renamed";

      await database.batch((b) => [b.save(message), b.save(discussion)]);

      expect(heard.filter((each) => each === "afterUpdateCommit")).toEqual(["afterUpdateCommit"]);
    });

    test("a record the batch destroys before saving one touching it is left destroyed", async () => {
      const database = db();
      const discussion = await database.model(HeardDiscussion).find(1);
      const message = discussion.messages().build({ body: "Late" });

      await database.batch((b) => [b.destroy(discussion), b.save(message)]);

      expect(discussion.isDestroyed()).toBe(true);
      expect(heard).not.toContain("afterTouch");
    });

    test("a saved record the refused batch touches runs afterRollback once", async () => {
      await harness.exec("INSERT INTO messages (id, discussion_id, body) VALUES (1, 1, 'Hi')");
      const database = db();
      const discussion = await database.model(HeardDiscussion).find(1);
      const message = database.model(HeardMessage).build({ id: 1, discussionId: 1, body: "Clash" });
      discussion.title = "Renamed";

      await expect(database.batch((b) => [b.save(discussion), b.save(message)])).rejects.toThrow();

      expect(heard.filter((each) => each === "afterRollback")).toEqual(["afterRollback"]);
    });

    test("a record the batch destroys isn't touched: no afterTouch or update commit callback", async () => {
      await harness.exec("INSERT INTO messages (id, discussion_id, body) VALUES (1, 1, 'Hi')");
      const database = db();
      const discussion = await database.model(HeardDiscussion).find(1);
      const message = await database.model(HeardMessage).find(1);

      await database.batch((b) => [b.destroy(message), b.destroy(discussion)]);

      expect(heard).not.toContain("afterTouch");
      expect(heard).not.toContain("afterUpdateCommit");
    });

    test("touch the record they belong to once", async () => {
      const events: QueryEvent[] = [];
      const database = recorded(events);
      const discussion = await database.model(Discussion).find(1);
      discussion.messages().build({ body: "One" });
      discussion.messages().build({ body: "Two" });
      events.length = 0;

      await discussion.saveOrThrow();

      expect(statementKinds(events).toSorted()).toEqual(["INSERT", "INSERT", "UPDATE"]);
    });

    test("in db.batch, b.save and b.destroy touch it once, in the batch", async () => {
      await harness.exec("INSERT INTO messages (id, discussion_id, body) VALUES (1, 1, 'Hi')");
      const events: QueryEvent[] = [];
      const database = recorded(events);
      const discussion = await database.model(Discussion).find(1);
      const [message] = await discussion.messages().toArray();
      const added = database.model(Message).build({ discussionId: 1, body: "New" });
      events.length = 0;

      await database.batch((b) => [b.save(added), b.destroy(message!)]);

      const writes = statementKinds(events).filter((kind) => kind !== "SELECT");
      expect(writes.toSorted()).toEqual(["DELETE", "INSERT", "UPDATE"]);
      expect((await updatedAt(1))!.getTime()).toBeGreaterThan(stale.getTime());
    });
  });

  describe("with a counter cache", () => {
    const counted = async (id: number) =>
      (await harness.exec("SELECT messages_count AS n FROM discussions WHERE id = ?", [id]))[0]?.n;

    beforeEach(() => {
      heard.length = 0;
    });

    test("creating sets the count and the time in one UPDATE, and runs the touch's callbacks", async () => {
      const events: QueryEvent[] = [];

      await recorded(events).model(CountedMessage).create({ discussionId: 1, body: "Hi" });

      expect(statementKinds(events)).toEqual(["SELECT", "INSERT", "UPDATE"]);
      expect(Number(await counted(1))).toBe(1);
      expect((await updatedAt(1))!.getTime()).toBeGreaterThan(stale.getTime());
      expect(heard).toEqual(["afterTouch", "afterUpdateCommit"]);
    });

    test("moving its key touches both in the counters' UPDATEs", async () => {
      await harness.exec("INSERT INTO messages (id, discussion_id, body) VALUES (1, 1, 'Hi')");
      await harness.exec("UPDATE discussions SET messages_count = 1 WHERE id = 1");
      const events: QueryEvent[] = [];
      const message = await recorded(events).model(CountedMessage).find(1);
      message.discussionId = 2;
      events.length = 0;

      await message.saveOrThrow();

      const writes = statementKinds(events).filter((kind) => kind !== "SELECT");
      expect(writes).toEqual(["UPDATE", "UPDATE", "UPDATE"]);
      expect([Number(await counted(1)), Number(await counted(2))]).toEqual([0, 1]);
      expect((await updatedAt(1))!.getTime()).toBeGreaterThan(stale.getTime());
      expect(await updatedAt(2)).toEqual(await updatedAt(1));
    });

    test("destroying touches in the counter's UPDATE", async () => {
      await harness.exec("INSERT INTO messages (id, discussion_id, body) VALUES (1, 1, 'Hi')");
      await harness.exec("UPDATE discussions SET messages_count = 1 WHERE id = 1");
      const events: QueryEvent[] = [];
      const message = await recorded(events).model(CountedMessage).find(1);
      events.length = 0;

      await message.destroyOrThrow();

      const writes = statementKinds(events).filter((kind) => kind !== "SELECT");
      expect(writes).toEqual(["UPDATE", "DELETE"]);
      expect(Number(await counted(1))).toBe(0);
      expect((await updatedAt(1))!.getTime()).toBeGreaterThan(stale.getTime());
      expect(heard).toEqual(["afterTouch", "afterUpdateCommit"]);
    });

    test("destroying with an unsaved key change touches the row's record in its counter's UPDATE, and the new one by its own", async () => {
      await harness.exec("INSERT INTO messages (id, discussion_id, body) VALUES (1, 1, 'Hi')");
      await harness.exec("UPDATE discussions SET messages_count = 1 WHERE id = 1");
      const events: QueryEvent[] = [];
      const message = await recorded(events).model(CountedMessage).find(1);
      message.discussionId = 2;
      events.length = 0;

      await message.destroyOrThrow();

      const writes = statementKinds(events).filter((kind) => kind !== "SELECT");
      expect(writes).toEqual(["UPDATE", "DELETE", "UPDATE"]);
      expect([Number(await counted(1)), Number(await counted(2))]).toEqual([0, 0]);
      expect((await updatedAt(1))!.getTime()).toBeGreaterThan(stale.getTime());
      expect(await updatedAt(2)).toEqual(await updatedAt(1));
    });

    test("a loaded record whose row is gone runs no commit callback", async () => {
      await harness.exec("INSERT INTO messages (id, discussion_id, body) VALUES (1, 1, 'Hi')");
      const [message] = await db().model(CountedMessage).includes("discussion").toArray();
      await harness.exec("DELETE FROM discussions WHERE id = 1");

      await message!.destroyOrThrow();

      expect(heard).toEqual(["afterTouch"]);
    });

    test("an update that keeps the count touches by its own UPDATE", async () => {
      await harness.exec("INSERT INTO messages (id, discussion_id, body) VALUES (1, 1, 'Hi')");
      const message = await db().model(CountedMessage).find(1);
      message.body = "Edited";

      await message.saveOrThrow();

      expect((await updatedAt(1))!.getTime()).toBeGreaterThan(stale.getTime());
      expect(Number(await counted(1))).toBe(0);
    });

    test("one the default scope hides takes the time with its count, but runs no callback", async () => {
      await harness.exec("UPDATE discussions SET archived = 1 WHERE id = 1");

      await db().model(CountedMessage).create({ discussionId: 1, body: "Hi" });

      expect(Number(await counted(1))).toBe(1);
      expect((await updatedAt(1))!.getTime()).toBeGreaterThan(stale.getTime());
      expect(heard).toEqual([]);
    });
  });

  describe("a polymorphic belongsTo", () => {
    beforeEach(async () => {
      await harness.exec("INSERT INTO forums (id, title, updated_at) VALUES (1, 'General', ?)", [
        stale.toISOString(),
      ]);
    });
    const forumUpdatedAt = async () => (await db().model(Forum).find(1)).updatedAt;

    test("touches the record of the Model its type names", async () => {
      await db().model(Sticker).create({ stickableType: "Forum", stickableId: 1 });

      expect((await forumUpdatedAt())!.getTime()).toBeGreaterThan(stale.getTime());
      expect(await updatedAt(1)).toEqual(stale);
    });

    test("moving it to another Model's record touches both", async () => {
      const sticker = await db()
        .model(Sticker)
        .create({ stickableType: "Discussion", stickableId: 1 });
      await harness.exec("UPDATE discussions SET updated_at = ?", [stale.toISOString()]);
      sticker.stickableType = "Forum";

      await sticker.saveOrThrow();

      expect((await forumUpdatedAt())!.getTime()).toBeGreaterThan(stale.getTime());
      expect(await updatedAt(1)).toEqual(await forumUpdatedAt());
    });
  });

  describe("writes that skip callbacks", () => {
    test("don't touch: updateColumns, updateAll and insert", async () => {
      await harness.exec("INSERT INTO messages (id, discussion_id, body) VALUES (1, 1, 'Hi')");
      const events: QueryEvent[] = [];
      const messages = recorded(events).model(Message);
      const message = await messages.find(1);
      events.length = 0;

      await message.updateColumns({ body: "Edited" });
      await messages.where({ id: 1 }).updateAll({ body: "Again" });
      await messages.insert({ discussionId: 1, body: "Bulk" });

      expect(events.map((event) => event.model)).toEqual(["Message", "Message", "Message"]);
      expect(await updatedAt(1)).toEqual(stale);
    });
  });

  describe("changing one attribute straight in the row", () => {
    test("doesn't touch: incrementColumn and toggleColumn", async () => {
      await harness.exec("INSERT INTO forums (id, title, updated_at) VALUES (1, 'General', ?)", [
        stale.toISOString(),
      ]);
      await harness.exec("UPDATE discussions SET forum_id = 1 WHERE id = 1");
      const events: QueryEvent[] = [];
      const discussion = await recorded(events).model(TallyDiscussion).find(1);
      events.length = 0;

      await discussion.incrementColumn("messagesCount");
      await discussion.toggleColumn("archived");

      expect(events.map((event) => event.model)).toEqual(["TallyDiscussion", "TallyDiscussion"]);
      expect((await db().model(Forum).find(1)).updatedAt).toEqual(stale);
    });
  });

  describe("a record it belongs to that the save creates", () => {
    beforeEach(() => {
      heard.length = 0;
    });

    test("takes the named attributes and runs afterTouch, but no update commit callback", async () => {
      const message = db().model(HeardMessage).build({ body: "First" });
      const discussion = message.discussion.build({ title: "New" });

      await message.saveOrThrow();

      const row = await db().model(HeardDiscussion).find(discussion.id);
      expect(row.lastMessageAt).not.toBeNull();
      expect(discussion.lastMessageAt).toEqual(row.lastMessageAt);
      expect(discussion.updatedAt).toEqual(row.updatedAt);
      expect(discussion.isChanged()).toBe(false);
      expect(heard).toContain("afterTouch");
      expect(heard).not.toContain("afterUpdateCommit");
    });

    test("with a key it's given, is touched in the same batch", async () => {
      const message = db().model(HeardMessage).build({ body: "First" });
      const discussion = message.discussion.build({ id: 7, title: "Keyed" });

      await message.saveOrThrow();

      const row = await db().model(HeardDiscussion).find(7);
      expect(row.lastMessageAt).not.toBeNull();
      expect(discussion.lastMessageAt).toEqual(row.lastMessageAt);
    });

    test("with a key it's given, runs afterRollback once when the batch is refused", async () => {
      await harness.exec("INSERT INTO messages (id, discussion_id, body) VALUES (1, 1, 'Hi')");
      const message = db().model(HeardMessage).build({ id: 1, body: "Clash" });
      message.discussion.build({ id: 7, title: "Keyed" });

      await expect(message.saveOrThrow()).rejects.toThrow();

      expect(heard.filter((each) => each === "afterRollback")).toEqual(["afterRollback"]);
    });

    test("inserted before the batch that's refused runs no afterRollback: its insert was kept", async () => {
      await harness.exec("INSERT INTO messages (id, discussion_id, body) VALUES (1, 1, 'Hi')");
      const message = db().model(HeardMessage).build({ id: 1, body: "Clash" });
      message.discussion.build({ title: "Generated" });

      await expect(message.saveOrThrow()).rejects.toThrow();

      expect(heard).not.toContain("afterRollback");
    });

    test("with a counter cache, holds the time its counter's UPDATE wrote", async () => {
      const message = db().model(CountedMessage).build({ body: "First" });
      const discussion = message.discussion.build({});

      await message.saveOrThrow();

      const row = await db().model(CountingDiscussion).find(discussion.id);
      expect(row.messagesCount).toBe(1);
      expect(discussion.updatedAt).toEqual(row.updatedAt);
      expect(heard).toEqual(["afterTouch"]);
    });
  });
});
