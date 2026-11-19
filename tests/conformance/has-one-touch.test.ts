import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { hasOne, InvalidModel, Model } from "../../packages/active-record/src/index.ts";
import type { QueryEvent } from "../../packages/active-record/src/executor.ts";
import { openHarness, type Harness } from "../support/harness.ts";
import { statementKinds } from "../support/statement-kinds.ts";

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
    await harness.exec("INSERT INTO forums (id, title, updated_at) VALUES (1, 'Forum', ?)", [
      stale.toISOString(),
    ]);
    await harness.exec(
      "INSERT INTO discussions (id, forum_id, title, updated_at) VALUES (1, 1, 'One', ?), (2, 2, 'Two', ?)",
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

  describe("saving its owner", () => {
    test("an owner updated with something to write touches its record, in its batch", async () => {
      const events: QueryEvent[] = [];
      const forum = await recorded(events).model(Forum).find(1);
      events.length = 0;

      await forum.update({ title: "Renamed" });

      expect(await updatedAt(1)).not.toEqual(stale);
      expect(statementKinds(events)).toEqual(["SELECT", "UPDATE", "UPDATE"]);
    });

    test("a save with nothing to write touches nothing", async () => {
      const events: QueryEvent[] = [];
      const forum = await recorded(events).model(Forum).find(1);
      events.length = 0;

      await forum.save();

      expect(events).toEqual([]);
      expect(await updatedAt(1)).toEqual(stale);
    });
  });
});
