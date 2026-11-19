import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  abort,
  AbortAfterPersistence,
  Model,
  RecordDestroyed,
  RecordNotSaved,
  RecordNotUnique,
  withDatabase,
} from "../../packages/active-record/src/index.ts";
import type { QueryEvent } from "../../packages/active-record/src/executor.ts";
import { statementKinds } from "../support/statement-kinds.ts";
import { openHarness, type Harness } from "../support/harness.ts";

/** A member whose timestamps `touch` sets. */
class Member extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  age: "integer",
  createdAt: "datetime",
  updatedAt: "datetime",
}) {
  static table = "users";
}

/** Members with no `updatedAt`, so touching one needs a name. */
class Unstamped extends Model.define({
  id: { type: "integer", null: false },
  createdAt: "datetime",
}) {
  static table = "users";
}

/** Members whose default scope leaves out inactive ones. */
class ActiveMember extends Model.define({
  id: { type: "integer", null: false },
  isActive: "boolean",
  updatedAt: "datetime",
}) {
  static table = "users";

  static {
    this.defaultScope((members) => members.where({ isActive: true }));
  }
}

/** The callbacks a touched Watched record ran, and what its `afterTouch` saw. */
const ran: string[] = [];

/** A member that records its callbacks, and could never pass validation. */
class Watched extends Model.define({
  id: { type: "integer", null: false },
  age: "integer",
  updatedAt: "datetime",
}) {
  static table = "users";

  static {
    this.validates("age", { numericality: { lessThan: 0 } });
    const kinds = [
      "beforeValidation",
      "afterValidation",
      "beforeSave",
      "beforeUpdate",
      "afterUpdate",
      "afterSave",
    ] as const;
    for (const kind of kinds) this[kind](() => void ran.push(kind));
    this.afterTouch((member) => {
      ran.push(`afterTouch ${member.changes().updatedAt ? "dirty" : "clean"}`);
    });
    const commits = [
      "afterSaveCommit",
      "afterCreateCommit",
      "afterCommit",
      "afterDestroyCommit",
      "afterUpdateCommit",
    ] as const;
    for (const kind of commits) this[kind](() => void ran.push(kind));
    this.afterRollback(() => void ran.push("afterRollback"));
  }
}

/**
 * A member whose `email` column holds a time, so touching two members at one time breaks its
 * uniqueness, and the database refuses the touch.
 */
class Clashing extends Model.define({
  id: { type: "integer", null: false },
  stamp: { type: "datetime", column: "email" },
}) {
  static table = "users";

  static {
    this.afterTouch(() => void ran.push("afterTouch"));
    this.afterCommit(() => void ran.push("afterCommit"));
    this.afterRollback((member) => void ran.push(`afterRollback ${member.stamp?.toISOString()}`));
  }
}

/** A member whose `afterTouch` aborts, too late to refuse anything. */
class LateAborter extends Model.define({
  id: { type: "integer", null: false },
  updatedAt: "datetime",
}) {
  static table = "users";

  static {
    this.afterTouch(() => {
      throw abort("Too late");
    });
  }
}

/** A time well before the test runs, so a touched timestamp can't hold it by chance. */
const stored = new Date("2026-01-02T03:04:05.000Z");

describe("touch (#50)", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());

  const events: QueryEvent[] = [];
  const db = () => harness.connect({ onQuery: (event) => events.push(event) });
  beforeEach(async () => {
    await harness.reset("users");
    await harness.exec(
      "INSERT INTO users (id, email, age, created_at, updated_at) VALUES (1, 'a@example.com', 3, ?, ?)",
      [stored.toISOString(), stored.toISOString()],
    );
    events.length = 0;
    ran.length = 0;
  });

  test("touch sets updatedAt to now in one UPDATE, and resolves to true", async () => {
    const member = await db().model(Member).find(1);
    const before = Date.now();
    events.length = 0;

    expect(await member.touch()).toBe(true);

    expect(statementKinds(events)).toEqual(["UPDATE"]);
    const reloaded = await db().model(Member).find(1);
    expect(reloaded.updatedAt!.getTime()).toBeGreaterThanOrEqual(before - 1000);
    expect(reloaded.createdAt).toEqual(stored);
    expect(member.updatedAt).toEqual(reloaded.updatedAt);
  });

  test("touch leaves the record's other changes unsaved, and the touched ones clean", async () => {
    const member = await db().model(Member).find(1);
    member.age = 9;

    await member.touch();

    expect(member.changes()).toEqual({ age: [3, 9] });
    expect((await db().model(Member).find(1)).age).toBe(3);
  });

  test("touch sets the datetime attributes it names, with updatedAt", async () => {
    const member = await db().model(Member).find(1);

    await member.touch("createdAt");

    const reloaded = await db().model(Member).find(1);
    expect(reloaded.createdAt).not.toEqual(stored);
    expect(reloaded.createdAt).toEqual(reloaded.updatedAt);
    expect(member.changes()).toEqual({});
  });

  test("touch sets the time it's given, alone or after names", async () => {
    const time = new Date("2026-05-06T07:08:09.000Z");
    const member = await db().model(Member).find(1);

    await member.touch({ time });
    expect((await db().model(Member).find(1)).updatedAt).toEqual(time);
    expect(member.updatedAt).toEqual(time);

    const later = new Date("2026-06-07T08:09:10.000Z");
    await member.touch("createdAt", { time: later });
    const reloaded = await db().model(Member).find(1);
    expect([reloaded.createdAt, reloaded.updatedAt]).toEqual([later, later]);
  });

  test("touch naming an attribute that isn't a datetime is a TypeError, before anything is sent", async () => {
    const member = await db().model(Member).find(1);
    events.length = 0;

    // @ts-expect-error touch names datetime attributes
    await expect(member.touch("age")).rejects.toThrow(
      new TypeError("Member.touch: touch takes datetime attributes; age isn't one"),
    );
    expect(events).toEqual([]);
    expect(member.changes()).toEqual({});
  });

  describe("what it refuses", () => {
    test("a new record is RecordNotSaved, before anything is sent", async () => {
      const member = db().model(Member).build({ email: "b@example.com" });

      await expect(member.touch()).rejects.toThrow(
        new RecordNotSaved("Member record hasn't been saved, so touch has no row to write"),
      );
      expect(events).toEqual([]);
      expect(member.updatedAt).toBeNull();
    });

    test("a destroyed record is RecordDestroyed", async () => {
      const member = await db().model(Member).find(1);
      await member.destroy();
      events.length = 0;

      await expect(member.touch()).rejects.toThrow(RecordDestroyed);
      expect(events).toEqual([]);
    });

    test("a Model with no updatedAt, touched with no names, is a TypeError", async () => {
      const member = await db().model(Unstamped).find(1);
      events.length = 0;

      await expect(member.touch()).rejects.toThrow(
        new TypeError(
          "Unstamped.touch has nothing to touch: Unstamped has no updatedAt; name a datetime attribute",
        ),
      );
      expect(events).toEqual([]);
    });

    test("a Model with no updatedAt touches the attributes it names", async () => {
      const member = await db().model(Unstamped).find(1);

      expect(await member.touch("createdAt", { time: stored })).toBe(true);
    });
  });

  test("touch resolves to false when the row is gone", async () => {
    const member = await db().model(Member).find(1);
    await harness.exec("DELETE FROM users WHERE id = 1");

    expect(await member.touch()).toBe(false);
  });

  test("touch writes the row by its key, whatever the default scope", async () => {
    const member = await db().model(ActiveMember).find(1);
    await harness.exec("UPDATE users SET is_active = ? WHERE id = 1", [false]);

    expect(await member.touch()).toBe(true);
  });

  describe("callbacks", () => {
    test("touch runs afterTouch once the row is written, and no validation or save callback", async () => {
      const member = await db().model(Watched).find(1);

      expect(await member.touch()).toBe(true);

      expect(ran).toEqual([
        "afterTouch clean",
        "afterSaveCommit",
        "afterCommit",
        "afterUpdateCommit",
      ]);
    });

    test("with no row to write, touch runs afterTouch but no commit callback", async () => {
      const member = await db().model(Watched).find(1);
      await harness.exec("DELETE FROM users WHERE id = 1");

      expect(await member.touch()).toBe(false);

      expect(ran).toEqual(["afterTouch clean"]);
    });

    test("a touch the database refuses runs afterRollback, and the record is as it was", async () => {
      const time = new Date("2026-05-06T07:08:09.000Z");
      await db().model(Clashing).create({ id: 2, stamp: time });
      const member = await db().model(Clashing).create({ id: 3, stamp: stored });
      ran.length = 0;

      await expect(member.touch("stamp", { time })).rejects.toThrow(RecordNotUnique);

      expect(ran).toEqual([`afterRollback ${stored.toISOString()}`]);
      expect(member.changes()).toEqual({});
    });

    test("an abort() in afterTouch is AbortAfterPersistence, and the touch is kept", async () => {
      const member = await db().model(LateAborter).find(1);

      const touched = new Date("2026-01-02T03:04:06.000Z");
      const error = await member.touch({ time: touched }).catch((thrown: unknown) => thrown);

      expect(error).toBeInstanceOf(AbortAfterPersistence);
      expect((error as Error).message).toBe(
        "abort() in afterTouch: the touch has already succeeded",
      );
      expect((await db().model(LateAborter).find(1)).updatedAt).toEqual(touched);
    });
  });

  describe("touchAll", () => {
    beforeEach(async () => {
      await harness.exec(
        "INSERT INTO users (id, email, age, is_active, created_at, updated_at) VALUES (2, 'b@example.com', 5, ?, ?, ?), (3, 'c@example.com', 7, ?, ?, ?)",
        [
          true,
          stored.toISOString(),
          stored.toISOString(),
          false,
          stored.toISOString(),
          stored.toISOString(),
        ],
      );
      events.length = 0;
    });

    /** Each member's id and updatedAt, by id, read back. */
    const stamps = async () =>
      (await db().model(Member).order({ id: "asc" }).toArray()).map((member) => [
        member.id,
        member.updatedAt,
      ]);

    test("touchAll sets updatedAt on the rows a Relation matches, in one UPDATE", async () => {
      const time = new Date("2026-05-06T07:08:09.000Z");

      expect(
        await db()
          .model(Member)
          .where({ age: [3, 5] })
          .touchAll({ time }),
      ).toBe(2);

      expect(statementKinds(events)).toEqual(["UPDATE"]);
      expect(await stamps()).toEqual([
        [1, time],
        [2, time],
        [3, stored],
      ]);
    });

    test("touchAll sets the datetime attributes it names, with updatedAt", async () => {
      const time = new Date("2026-05-06T07:08:09.000Z");

      await db().model(Member).where({ id: 2 }).touchAll("createdAt", { time });

      const member = await db().model(Member).find(2);
      expect([member.createdAt, member.updatedAt]).toEqual([time, time]);
    });

    test("touchAll as a static keeps the default scope", async () => {
      const time = new Date("2026-05-06T07:08:09.000Z");

      expect(await withDatabase(db(), () => ActiveMember.touchAll({ time }))).toBe(2);

      expect(await stamps()).toEqual([
        [1, time],
        [2, time],
        [3, stored],
      ]);
    });

    test("touchAll on none() sends nothing", async () => {
      expect(await db().model(Member).none().touchAll()).toBe(0);
      expect(events).toEqual([]);
    });

    test("touchAll with nothing to touch, or an attribute that isn't a datetime, is a TypeError", async () => {
      await expect(db().model(Unstamped).touchAll()).rejects.toThrow(
        new TypeError(
          "Unstamped.touchAll has nothing to touch: Unstamped has no updatedAt; name a datetime attribute",
        ),
      );
      // @ts-expect-error touchAll names datetime attributes
      await expect(db().model(Member).touchAll("age")).rejects.toThrow(
        new TypeError("Member.touchAll: touch takes datetime attributes; age isn't one"),
      );
      expect(events).toEqual([]);
    });
  });

  describe("incrementColumn's touch", () => {
    test("incrementColumn with touch sets updatedAt in the counter's UPDATE, and holds it", async () => {
      const member = await db().model(Member).find(1);
      events.length = 0;

      expect(await member.incrementColumn("age", 2, { touch: true })).toBe(true);

      expect(statementKinds(events)).toEqual(["UPDATE"]);
      const reloaded = await db().model(Member).find(1);
      expect(reloaded.age).toBe(5);
      expect(reloaded.updatedAt).not.toEqual(stored);
      expect(member.updatedAt).toEqual(reloaded.updatedAt);
      expect(member.changes()).toEqual({});
    });

    test("decrementColumn with touch naming an attribute sets it with updatedAt", async () => {
      const member = await db().model(Member).find(1);

      await member.decrementColumn("age", 1, { touch: "createdAt" });

      const reloaded = await db().model(Member).find(1);
      expect([reloaded.age, member.createdAt]).toEqual([2, reloaded.createdAt]);
      expect(reloaded.createdAt).toEqual(reloaded.updatedAt);
      expect(reloaded.createdAt).not.toEqual(stored);
    });

    test("incrementColumn with touch naming an attribute that isn't a datetime is a TypeError", async () => {
      const member = await db().model(Member).find(1);
      events.length = 0;

      // @ts-expect-error touch names datetime attributes
      await expect(member.incrementColumn("age", 1, { touch: "email" })).rejects.toThrow(
        new TypeError("Member.incrementColumn: touch takes datetime attributes; email isn't one"),
      );
      expect(events).toEqual([]);
      expect(member.changes()).toEqual({});
    });
  });
});
