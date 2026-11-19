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
    await harness.reset("messages", "discussions", "forums");
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

    test("a new record it belongs to isn't touched: its insert sets updatedAt", async () => {
      const events: QueryEvent[] = [];
      const message = recorded(events).model(Message).build({ body: "First" });
      message.discussion.build({ title: "New" });

      await message.saveOrThrow();

      expect(statementKinds(events)).toEqual(["INSERT", "INSERT"]);
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
});
