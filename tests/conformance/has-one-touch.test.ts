import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { belongsTo, hasOne, InvalidModel, Model } from "../../packages/active-record/src/index.ts";
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

/** What the callbacks below heard, in order. */
const heard: string[] = [];

/** A discussion whose callbacks say when they run, touching its forum back. */
class HeardDiscussion extends Model.define({
  id: { type: "integer", null: false },
  forumId: "integer",
  updatedAt: "datetime",
}) {
  static table = "discussions";
  forum = belongsTo(TouchedForum, { foreignKey: "forumId", touch: true, optional: true });
  static {
    this.afterTouch(() => void heard.push("afterTouch"));
    this.afterUpdateCommit(() => void heard.push("afterUpdateCommit"));
    this.afterRollback(() => void heard.push("afterRollback"));
  }
}

/** A forum its discussion touches back, as the forum touches it. */
class TouchedForum extends Model.define({
  id: { type: "integer", null: false },
  title: "string",
  updatedAt: "datetime",
}) {
  static table = "forums";
  discussion = hasOne(HeardDiscussion, { foreignKey: "forumId", touch: true });
}

/** A forum saving its discussion's changes with its own. */
class AutosavingForum extends Model.define({
  id: { type: "integer", null: false },
  title: "string",
}) {
  static table = "forums";
  discussion = hasOne(HeardDiscussion, { foreignKey: "forumId", touch: true, autosave: true });
}

/** Forums whose discussion goes with them, or stays, as their dependent says. */
class DestroyingForum extends Model.define({ id: { type: "integer", null: false } }) {
  static table = "forums";
  discussion = hasOne(Discussion, { foreignKey: "forumId", touch: true, dependent: "destroy" });
}

class DeletingForum extends Model.define({ id: { type: "integer", null: false } }) {
  static table = "forums";
  discussion = hasOne(Discussion, { foreignKey: "forumId", touch: true, dependent: "delete" });
}

class NullifyingForum extends Model.define({ id: { type: "integer", null: false } }) {
  static table = "forums";
  discussion = hasOne(Discussion, { foreignKey: "forumId", touch: true, dependent: "nullify" });
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
    heard.length = 0;
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

  describe("touching its owner", () => {
    test("the owner's touch() touches its record in the same batch", async () => {
      const events: QueryEvent[] = [];
      const forum = await recorded(events).model(Forum).find(1);
      events.length = 0;

      await forum.touch();

      expect(await updatedAt(1)).not.toEqual(stale);
      expect(statementKinds(events)).toEqual(["SELECT", "UPDATE", "UPDATE"]);
    });

    test("a record touching its owner back touches it once, and runs its callbacks", async () => {
      const events: QueryEvent[] = [];
      const forum = await recorded(events).model(TouchedForum).find(1);
      events.length = 0;

      await forum.touch();

      expect(statementKinds(events)).toEqual(["SELECT", "UPDATE", "UPDATE"]);
      expect(heard).toEqual(["afterTouch", "afterUpdateCommit"]);
    });
  });

  describe("destroying its owner", () => {
    test("with no dependent, its record is touched", async () => {
      const forum = await db().model(Forum).find(1);

      await forum.destroy();

      expect(await updatedAt(1)).not.toEqual(stale);
    });

    test("with nullify, its record is touched once it's let go", async () => {
      const forum = await db().model(NullifyingForum).find(1);

      await forum.destroy();

      const discussion = await db().model(Discussion).find(1);
      expect(discussion.forumId).toBeNull();
      expect(discussion.updatedAt).not.toEqual(stale);
    });

    test.each([
      ["destroy", DestroyingForum],
      ["delete", DeletingForum],
    ] as const)("with %s, the record removed with it isn't touched", async (_, model) => {
      const events: QueryEvent[] = [];
      const forum = await recorded(events).model(model).find(1);
      events.length = 0;

      await forum.destroy();

      expect(statementKinds(events)).not.toContain("UPDATE");
      expect(await db().model(Discussion).findBy({ id: 1 })).toBeNull();
    });
  });

  describe("the record's callbacks", () => {
    test("a batch the database refuses runs its afterRollback", async () => {
      const database = db();
      const forum = await database.model(TouchedForum).find(1);
      forum.title = "Renamed";

      const refused = database.batch((b) => [
        b.save(forum),
        b.insert(database.model(Discussion), { id: 1, title: "Taken" }),
      ]);

      await expect(refused).rejects.toThrow();
      expect(heard).toEqual(["afterRollback"]);
      expect(await updatedAt(1)).toEqual(stale);
    });
  });

  describe("a record the same write saves", () => {
    test("a new one built through the owner is inserted, not touched", async () => {
      const forum = await db().model(TouchedForum).find(1);
      const built = forum.discussion.build();
      forum.title = "Renamed";

      await forum.saveOrThrow();

      expect(built.isPersisted()).toBe(true);
      expect(heard).not.toContain("afterTouch");
    });

    test("a changed one the owner autosaves is saved, not touched", async () => {
      const forum = await db().model(AutosavingForum).find(1);
      const discussion = (await forum.discussion())!;
      forum.title = "Renamed";
      const time = new Date("2030-01-01T00:00:00.000Z");
      discussion.updatedAt = time;

      await forum.saveOrThrow();

      expect(heard).not.toContain("afterTouch");
      expect(await updatedAt(1)).toEqual(time);
    });
  });
});
