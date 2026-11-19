import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { belongsTo, hasMany, InvalidModel, Model } from "../../packages/active-record/src/index.ts";
import { openHarness, type Harness } from "../support/harness.ts";

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

describe("a belongsTo's touch (#353)", () => {
  let harness: Harness;
  const db = () => harness.connect();

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.reset("messages", "discussions", "forums");
  });

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
});
