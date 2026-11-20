import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  belongsTo,
  hasMany,
  Model,
  RecordDestroyed,
  RecordNotSaved,
  withDatabase,
} from "../../packages/active-record/src/index.ts";
import type { QueryEvent } from "../../packages/active-record/src/executor.ts";
import { openHarness, type Harness } from "../support/harness.ts";
import { statementKinds } from "../support/statement-kinds.ts";

class Forum extends Model.define({
  id: { type: "integer", null: false },
  title: "string",
  updatedAt: "datetime",
}) {
  static table = "forums";
}

class Discussion extends Model.define({
  id: { type: "integer", null: false },
  forumId: "integer",
  title: "string",
  updatedAt: "datetime",
}) {
  static table = "discussions";
  forum = belongsTo(Forum, { touch: true, optional: true });
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

/** A sticker on a discussion or a forum, touching whichever it's on. */
class Sticker extends Model.define({
  id: { type: "integer", null: false },
  stickableType: "string",
  stickableId: "integer",
}) {
  static table = "stickers";
  stickable = belongsTo([Discussion, Forum], { touch: true, optional: true });
}

/** An app's base class, which its Models extend. */
abstract class AppRecord extends Model {}

/** A forum built on the app's base class. */
class AppForum extends AppRecord.define({
  id: { type: "integer", null: false },
  updatedAt: "datetime",
}) {
  static table = "forums";
}

/** A discussion built on the app's base class, touching its forum. */
class AppDiscussion extends AppRecord.define({
  id: { type: "integer", null: false },
  forumId: "integer",
}) {
  static table = "discussions";
  forum = belongsTo(AppForum, { foreignKey: "forumId", touch: true });
}

/** A discussion of a Model extending Discussion, which Discussion's block covers. */
class PinnedDiscussion extends Discussion {
  static override table = "discussions";
}

class PinnedMessage extends Model.define({
  id: { type: "integer", null: false },
  discussionId: "integer",
}) {
  static table = "messages";
  discussion = belongsTo(PinnedDiscussion, { foreignKey: "discussionId", touch: true });
}

/** What the callbacks below heard, in order. */
const heard: string[] = [];

/** A discussion whose callbacks say when they run. */
class HeardDiscussion extends Model.define({
  id: { type: "integer", null: false },
  title: "string",
  updatedAt: "datetime",
}) {
  static table = "discussions";
  static {
    this.afterTouch(() => void heard.push("afterTouch"));
    this.afterCommit(() => void heard.push("afterCommit"));
  }
}

/** A discussion counting its messages. */
class CountingDiscussion extends Model.define({
  id: { type: "integer", null: false },
  messagesCount: "integer",
  updatedAt: "datetime",
}) {
  static table = "discussions";
  messages = hasMany(CountedMessage, { foreignKey: "discussionId" });
}

/** A message counted on its discussion, which it touches with its count. */
class CountedMessage extends Model.define({
  id: { type: "integer", null: false },
  discussionId: "integer",
}) {
  static table = "messages";
  discussion = belongsTo(CountingDiscussion, {
    foreignKey: "discussionId",
    counterCache: "messagesCount",
    touch: true,
  });
}

describe("noTouching (#496)", () => {
  let harness: Harness;
  const db = () => harness.connect();

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    heard.length = 0;
    await harness.reset("stickers", "messages", "discussions", "forums");
    await harness.exec("INSERT INTO forums (id, title, updated_at) VALUES (1, 'Forum', ?)", [
      stale.toISOString(),
    ]);
    await harness.exec(
      "INSERT INTO discussions (id, forum_id, title, updated_at) VALUES (1, 1, 'One', ?)",
      [stale.toISOString()],
    );
  });

  /** A time before every test's writes. */
  const stale = new Date("2020-01-01T00:00:00.000Z");
  const updatedAtOf = async (
    model: typeof Forum | typeof Discussion | typeof CountingDiscussion,
    id: number,
  ) => (await db().model(model).find(id)).updatedAt;
  /** A Database whose statements are recorded in `events`. */
  const recorded = (events: QueryEvent[]) =>
    harness.connect({ onQuery: (event) => void events.push(event) });

  describe("turning a Model's touches off", () => {
    test("a record created inside doesn't touch the record it belongs to", async () => {
      const events: QueryEvent[] = [];
      const messages = recorded(events).model(Message);

      await Discussion.noTouching(() => messages.create({ discussionId: 1, body: "Hi" }));

      expect(await updatedAtOf(Discussion, 1)).toEqual(stale);
      expect(statementKinds(events)).toEqual(["INSERT"]); // the discussion isn't read
    });

    test("a record moved to another doesn't read either one", async () => {
      await harness.exec("INSERT INTO discussions (id, title, updated_at) VALUES (2, 'Two', ?)", [
        stale.toISOString(),
      ]);
      await harness.exec("INSERT INTO messages (id, discussion_id, body) VALUES (1, 1, 'Hi')");
      const events: QueryEvent[] = [];
      const message = await recorded(events).model(Message).find(1);
      events.length = 0;

      await Discussion.noTouching(() => message.update({ discussionId: 2 }));

      expect(statementKinds(events)).toEqual(["UPDATE"]);
    });

    test("a cascade doesn't read the record a covered Model's record would touch", async () => {
      const events: QueryEvent[] = [];
      const messages = recorded(events).model(Message);

      await Forum.noTouching(() => messages.create({ discussionId: 1, body: "Hi" }));

      // The discussion is read and touched; its forum isn't read.
      expect(statementKinds(events)).toEqual(["SELECT", "INSERT", "UPDATE"]);
    });

    test("a block on only a Model extending the target still reads the record", async () => {
      const events: QueryEvent[] = [];
      const messages = recorded(events).model(Message);

      await PinnedDiscussion.noTouching(() => messages.create({ discussionId: 1, body: "Hi" }));

      expect(statementKinds(events)[0]).toBe("SELECT");
      expect(await updatedAtOf(Discussion, 1)).not.toEqual(stale);
    });

    /** A sticker on discussion 1, created inside `model`'s block, and the statements it sent. */
    const stickerInside = async (model: typeof Model) => {
      const events: QueryEvent[] = [];
      const stickers = recorded(events).model(Sticker);
      await model.noTouching(() =>
        stickers.create({ stickableType: "Discussion", stickableId: 1 }),
      );
      return statementKinds(events);
    };

    test("a polymorphic belongsTo whose every Model is covered doesn't read", async () => {
      expect(await stickerInside(Model)).toEqual(["INSERT"]);
    });

    test("a polymorphic belongsTo with a Model still touched reads, and touches", async () => {
      expect(await stickerInside(Forum)).toContain("SELECT");
      expect(await updatedAtOf(Discussion, 1)).not.toEqual(stale);
    });

    /** A saved message, its discussion's updatedAt set back to `stale` after its insert. */
    const savedMessage = async () => {
      const message = await db().model(Message).create({ discussionId: 1, body: "Hi" });
      await harness.exec("UPDATE discussions SET updated_at = ?", [stale.toISOString()]);
      return message;
    };

    test("a record updated inside doesn't touch the record it belongs to", async () => {
      const message = await savedMessage();

      await Discussion.noTouching(() => message.update({ body: "Hello" }));

      expect(await updatedAtOf(Discussion, 1)).toEqual(stale);
    });

    test("a record destroyed inside doesn't touch the record it belongs to", async () => {
      const message = await savedMessage();

      await Discussion.noTouching(() => message.destroy());

      expect(await updatedAtOf(Discussion, 1)).toEqual(stale);
    });

    test("a record saved in a batch inside doesn't touch the record it belongs to", async () => {
      const database = db();
      const message = database.model(Message).build({ discussionId: 1, body: "Hi" });

      await Discussion.noTouching(() => database.batch((b) => [b.save(message)]));

      expect(message.isPersisted()).toBe(true);
      expect(await updatedAtOf(Discussion, 1)).toEqual(stale);
    });

    test("once the block has ended, its records are touched again", async () => {
      await Discussion.noTouching(() => undefined);

      await db().model(Message).create({ discussionId: 1, body: "Hi" });

      expect(await updatedAtOf(Discussion, 1)).not.toEqual(stale);
    });

    test("a record of a Model extending the one turned off isn't touched", async () => {
      await Discussion.noTouching(() => db().model(PinnedMessage).create({ discussionId: 1 }));

      expect(await updatedAtOf(Discussion, 1)).toEqual(stale);
    });

    test("Model.noTouching turns every Model's touches off", async () => {
      await Model.noTouching(() => db().model(Message).create({ discussionId: 1, body: "Hi" }));

      expect(await updatedAtOf(Discussion, 1)).toEqual(stale);
      expect(await updatedAtOf(Forum, 1)).toEqual(stale);
    });

    test("the app's base class turns off the touches of every Model built on it", async () => {
      const discussions = db().model(AppDiscussion);

      await AppRecord.noTouching(() => discussions.create({ forumId: 1 }));

      expect(await updatedAtOf(Forum, 1)).toEqual(stale);
    });

    test("other Models are still touched: the discussion, but not its forum", async () => {
      await Forum.noTouching(() => db().model(Message).create({ discussionId: 1, body: "Hi" }));

      expect(await updatedAtOf(Discussion, 1)).not.toEqual(stale);
      expect(await updatedAtOf(Forum, 1)).toEqual(stale);
    });

    test("a record that isn't touched doesn't touch its own in turn", async () => {
      await Discussion.noTouching(() =>
        db().model(Message).create({ discussionId: 1, body: "Hi" }),
      );

      expect(await updatedAtOf(Forum, 1)).toEqual(stale);
    });

    test("it's the touched record's Model that counts, not the one touching it", async () => {
      await Message.noTouching(() => db().model(Message).create({ discussionId: 1, body: "Hi" }));

      expect(await updatedAtOf(Discussion, 1)).not.toEqual(stale);
    });

    test("it resolves to what its function returns", async () => {
      expect(await Discussion.noTouching(() => 42)).toBe(42);
      expect(await Discussion.noTouching(async () => "done")).toBe("done");
    });
  });

  describe("touch() inside", () => {
    test("writes nothing, runs no callback, and resolves to false", async () => {
      const events: QueryEvent[] = [];
      const discussion = await recorded(events).model(HeardDiscussion).find(1);
      events.length = 0;

      const touched = await HeardDiscussion.noTouching(() => discussion.touch());

      expect(touched).toBe(false);
      expect(events).toEqual([]);
      expect(heard).toEqual([]);
      expect(discussion.updatedAt).toEqual(stale);
    });

    test("a record whose touches are on still touches, but not the one it belongs to", async () => {
      const message = await db().model(Message).create({ discussionId: 1, body: "Hi" });
      await harness.exec("UPDATE discussions SET updated_at = ?", [stale.toISOString()]);
      const time = new Date("2030-01-01T00:00:00.000Z");

      expect(await Discussion.noTouching(() => message.touch({ time }))).toBe(true);

      expect((await db().model(Message).find(message.id)).updatedAt).toEqual(time);
      expect(await updatedAtOf(Discussion, 1)).toEqual(stale);
    });

    test("its mistakes still throw", async () => {
      const discussion = await db().model(HeardDiscussion).find(1);

      await HeardDiscussion.noTouching(async () => {
        await expect(discussion.touch("title" as never)).rejects.toThrow(TypeError);
        await expect(db().model(HeardDiscussion).build().touch()).rejects.toThrow(RecordNotSaved);
      });
    });

    test("on a destroyed record, it still throws RecordDestroyed", async () => {
      const destroyed = await db().model(HeardDiscussion).find(1);
      await destroyed.destroy();

      const touched = HeardDiscussion.noTouching(() => destroyed.touch());

      await expect(touched).rejects.toThrow(RecordDestroyed);
    });
  });

  describe("what it leaves on", () => {
    /** The writes that touch by an option or by name, which `noTouching` leaves alone. */
    const optionTouches: [string, () => Promise<unknown>][] = [
      ["touchAll", () => CountingDiscussion.where({ id: 1 }).touchAll()],
      [
        "updateCounters",
        () => CountingDiscussion.updateCounters(1, { messagesCount: 1 }, { touch: true }),
      ],
      [
        "incrementColumn",
        async () =>
          (await CountingDiscussion.find(1)).incrementColumn("messagesCount", 1, { touch: true }),
      ],
      ["resetCounters", () => CountingDiscussion.resetCounters(1, "messages", { touch: true })],
    ];

    test.each(optionTouches)("%s still sets updatedAt", async (_, write) => {
      await withDatabase(db(), () => Model.noTouching(write));

      expect(await updatedAtOf(CountingDiscussion, 1)).not.toEqual(stale);
    });

    test("a save still sets its own record's updatedAt", async () => {
      const discussion = await db().model(Discussion).find(1);

      await Model.noTouching(() => discussion.update({ title: "Renamed" }));

      expect(await updatedAtOf(Discussion, 1)).not.toEqual(stale);
    });

    test("a belongsTo with a counter cache still counts, but doesn't touch", async () => {
      await CountingDiscussion.noTouching(() =>
        db().model(CountedMessage).create({ discussionId: 1 }),
      );

      const discussion = await db().model(CountingDiscussion).find(1);
      expect(discussion.messagesCount).toBe(1);
      expect(discussion.updatedAt).toEqual(stale);
    });
  });

  describe("where it applies", () => {
    test("work running at the same time outside the block still touches", async () => {
      await harness.exec(
        "INSERT INTO discussions (id, forum_id, title, updated_at) VALUES (2, 1, 'Two', ?)",
        [stale.toISOString()],
      );
      const messages = db().model(Message);
      let release!: () => void;
      const held = new Promise<void>((resolve) => (release = resolve));

      const inside = Discussion.noTouching(async () => {
        await held;
        await messages.create({ discussionId: 1, body: "Inside" });
      });
      const outside = messages.create({ discussionId: 2, body: "Outside" });
      await outside;
      release();
      await inside;

      expect(await updatedAtOf(Discussion, 1)).toEqual(stale);
      expect(await updatedAtOf(Discussion, 2)).not.toEqual(stale);
    });

    test("nested blocks add their Models, and the outer one's stay off after an inner ends", async () => {
      const messages = db().model(Message);

      await Forum.noTouching(async () => {
        await Discussion.noTouching(() => messages.create({ discussionId: 1, body: "Hi" }));
        expect(await updatedAtOf(Discussion, 1)).toEqual(stale);
        await messages.create({ discussionId: 1, body: "Again" });
      });

      expect(await updatedAtOf(Discussion, 1)).not.toEqual(stale);
      expect(await updatedAtOf(Forum, 1)).toEqual(stale);
    });

    test("withDatabase inside or around it keeps both", async () => {
      const database = db();
      await withDatabase(database, () =>
        Discussion.noTouching(() =>
          withDatabase(database, () => Message.create({ discussionId: 1, body: "Hi" })),
        ),
      );

      expect(await updatedAtOf(Discussion, 1)).toEqual(stale);
    });

    test("a function that throws rejects with its error, and the block ends", async () => {
      const failure = new Error("import failed");

      await expect(
        Discussion.noTouching(() => {
          throw failure;
        }),
      ).rejects.toBe(failure);
      await db().model(Message).create({ discussionId: 1, body: "Hi" });

      expect(await updatedAtOf(Discussion, 1)).not.toEqual(stale);
    });
  });
});
