import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { belongsTo, Model, RecordNotSaved } from "../../packages/active-record/src/index.ts";
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

describe("noTouching (#496)", () => {
  let harness: Harness;
  const db = () => harness.connect();

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    heard.length = 0;
    await harness.reset("messages", "discussions", "forums");
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
  const updatedAtOf = async (model: typeof Forum | typeof Discussion, id: number) =>
    (await db().model(model).find(id)).updatedAt;
  /** A Database whose statements are recorded in `events`. */
  const recorded = (events: QueryEvent[]) =>
    harness.connect({ onQuery: (event) => void events.push(event) });

  describe("turning a Model's touches off", () => {
    test("a record created inside doesn't touch the record it belongs to", async () => {
      const events: QueryEvent[] = [];
      const messages = recorded(events).model(Message);

      await Discussion.noTouching(() => messages.create({ discussionId: 1, body: "Hi" }));

      expect(await updatedAtOf(Discussion, 1)).toEqual(stale);
      expect(statementKinds(events)).toEqual(["SELECT", "INSERT"]);
    });

    test("a record updated or destroyed inside doesn't touch it either", async () => {
      const message = await db().model(Message).create({ discussionId: 1, body: "Hi" });
      await harness.exec("UPDATE discussions SET updated_at = ?", [stale.toISOString()]);

      await Discussion.noTouching(async () => {
        await message.update({ body: "Hello" });
        await message.destroy();
      });

      expect(await updatedAtOf(Discussion, 1)).toEqual(stale);
    });

    test("once the block has ended, its records are touched again", async () => {
      await Discussion.noTouching(() => undefined);

      await db().model(Message).create({ discussionId: 1, body: "Hi" });

      expect(await updatedAtOf(Discussion, 1)).not.toEqual(stale);
    });

    test("a Model extending it isn't touched either", async () => {
      await Discussion.noTouching(() => db().model(PinnedMessage).create({ discussionId: 1 }));

      expect(await updatedAtOf(Discussion, 1)).toEqual(stale);
    });

    test("Model.noTouching turns every Model's touches off", async () => {
      await Model.noTouching(() => db().model(Message).create({ discussionId: 1, body: "Hi" }));

      expect(await updatedAtOf(Discussion, 1)).toEqual(stale);
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
  });
});
