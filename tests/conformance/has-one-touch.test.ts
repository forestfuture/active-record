import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { hasOne, InvalidModel, Model } from "../../packages/active-record/src/index.ts";
import { openHarness, type Harness } from "../support/harness.ts";

class Discussion extends Model.define({
  id: { type: "integer", null: false },
  forumId: "integer",
  title: "string",
  updatedAt: "datetime",
  lastMessageAt: "datetime",
}) {
  static table = "discussions";
}

/** A forum and the one discussion pinned to it, which it touches. */
class Forum extends Model.define({
  id: { type: "integer", null: false },
  title: "string",
  updatedAt: "datetime",
}) {
  static table = "forums";
  discussion = hasOne(Discussion, { touch: true });
}

/** A discussion without timestamps, which `touch: true` has nothing to set on. */
class PlainDiscussion extends Model.define({
  id: { type: "integer", null: false },
  forumId: "integer",
}) {
  static table = "discussions";
}

describe("a hasOne's touch (#497)", () => {
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
    test("true, a datetime attribute, or a list of them, is declared", () => {
      class Named extends Model.define({ id: { type: "integer", null: false } }) {
        static table = "forums";
        discussion = hasOne(Discussion, { foreignKey: "forumId", touch: ["lastMessageAt"] });
      }

      expect(db().model(Forum).build()).toBeInstanceOf(Forum);
      expect(db().model(Named).build()).toBeInstanceOf(Named);
    });

    test("a target without updatedAt touched with true is an InvalidModel at first use", () => {
      class Untimed extends Model.define({ id: { type: "integer", null: false } }) {
        static table = "forums";
        discussion = hasOne(PlainDiscussion, { foreignKey: "forumId", touch: true });
      }

      expect(() => db().model(Untimed).build()).toThrow(
        new InvalidModel(
          "Untimed association \"discussion\": touch: true sets PlainDiscussion's updatedAt, which it doesn't have (name a datetime attribute)",
        ),
      );
    });
  });
});
