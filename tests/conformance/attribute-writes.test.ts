import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  Model,
  RecordDestroyed,
  RecordNotSaved,
  withDatabase,
} from "../../packages/active-record/src/index.ts";
import type { QueryEvent } from "../../packages/active-record/src/executor.ts";
import { openHarness, type Harness } from "../support/harness.ts";

class Member extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  age: "integer",
  suspended: "integer",
  isActive: "boolean",
  updatedAt: "datetime",
}) {
  static table = "users";

  static {
    this.validates("age", { numericality: { lessThan: 100 } });
    for (const kind of ["beforeValidation", "beforeSave", "afterSave", "afterCommit"] as const) {
      this[kind](() => void callbacks.push(kind));
    }
    this.afterSave((member) => void previouslyNew.push(member.isPreviouslyNewRecord()));
  }
}

/** Members whose default scope leaves out inactive ones. */
class ActiveMember extends Model.define({
  id: { type: "integer", null: false },
  age: "integer",
  isActive: "boolean",
}) {
  static table = "users";

  static {
    this.defaultScope((members) => members.where({ isActive: true }));
  }
}

/** The callbacks Member's records ran. */
const callbacks: string[] = [];
/** What `isPreviouslyNewRecord()` said in each of Member's afterSave callbacks. */
const previouslyNew: boolean[] = [];

/** A name or amount the method's type refuses, as one from untyped code would arrive. */
const untyped = (value: unknown) => value as never;

describe("changing one attribute (#351)", () => {
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
      "INSERT INTO users (id, email, age, is_active) VALUES (1, 'a@example.com', 3, ?)",
      [true],
    );
    events.length = 0;
    callbacks.length = 0;
    previouslyNew.length = 0;
  });

  describe("in memory", () => {
    test("increment adds one, or by, and leaves the change unsaved", async () => {
      const member = await db().model(Member).find(1);
      events.length = 0;

      expect(member.increment("age")).toBe(member);
      expect(member.age).toBe(4);
      member.increment("age", 5);

      expect(member.age).toBe(9);
      expect(member.changes()).toEqual({ age: [3, 9] });
      expect(events).toEqual([]);
    });

    test("decrement takes one, or by", async () => {
      const member = await db().model(Member).find(1);

      member.decrement("age").decrement("age", 2);

      expect(member.age).toBe(0);
    });

    test("increment starts a null attribute at zero", async () => {
      const member = db().model(Member).build({ email: "b@example.com" });

      member.increment("age", 2);

      expect(member.age).toBe(2);
    });

    test("toggle flips a boolean, and makes null true", async () => {
      const member = await db().model(Member).find(1);
      const blank = db().model(Member).build({ email: "b@example.com" });

      member.toggle("isActive");
      blank.toggle("isActive");

      expect(member.isActive).toBe(false);
      expect(blank.isActive).toBe(true);
      expect(member.changes()).toEqual({ isActive: [true, false] });
    });

    test("increment and toggle refuse an attribute of another type", async () => {
      const member = await db().model(Member).find(1);

      expect(() => member.increment(untyped("email"))).toThrow(TypeError);
      expect(() => member.toggle(untyped("age"))).toThrow(TypeError);
      expect(member.changes()).toEqual({});
    });

    test("increment refuses an amount that isn't a number", async () => {
      const member = await db().model(Member).find(1);

      expect(() => member.increment("age", untyped("5"))).toThrow(TypeError);
      expect(() => member.decrement("age", untyped(null))).toThrow(TypeError);
      expect(member.changes()).toEqual({});
    });
  });

  describe("updateColumns", () => {
    test("writes straight to the row, and leaves the record clean for what it wrote", async () => {
      const member = await db().model(Member).find(1);
      member.email = "changed@example.com";
      events.length = 0;

      expect(await member.updateColumns({ age: 500, isActive: false })).toBe(true);

      expect(member.age).toBe(500);
      expect(member.changes()).toEqual({ email: ["a@example.com", "changed@example.com"] });
      expect(events.length).toBe(1);
      const row = await db().model(Member).find(1);
      expect(row.attributes()).toMatchObject({ age: 500, isActive: false, email: "a@example.com" });
    });

    test("runs no validation or callback, and leaves updatedAt and savedChanges alone", async () => {
      const member = await db().model(Member).find(1);

      await member.updateColumns({ age: 500 });

      expect(callbacks).toEqual([]);
      expect(member.savedChanges()).toEqual({});
      expect(member.updatedAt).toBeNull();
      expect((await db().model(Member).find(1)).updatedAt).toBeNull();
    });

    test("updateColumn writes one attribute", async () => {
      const member = await db().model(Member).find(1);

      expect(await member.updateColumn("age", 7)).toBe(true);

      expect(member.isChanged()).toBe(false);
      expect((await db().model(Member).find(1)).age).toBe(7);
    });

    test("resolves to false when the row is gone", async () => {
      const member = await db().model(Member).find(1);
      await harness.exec("DELETE FROM users");

      expect(await member.updateColumns({ age: 7 })).toBe(false);
    });

    test("refuses no attributes with a TypeError", async () => {
      const member = await db().model(Member).find(1);
      events.length = 0;

      await expect(member.updateColumns({})).rejects.toThrow(TypeError);
      expect(events).toEqual([]);
    });

    test("refuses a new record with RecordNotSaved", async () => {
      const member = db().model(Member).build({ email: "b@example.com" });

      await expect(member.updateColumns({ age: 7 })).rejects.toThrow(RecordNotSaved);
      expect(events).toEqual([]);
    });

    test("refuses a destroyed record with RecordDestroyed", async () => {
      const member = await db().model(Member).find(1);
      await member.destroy();

      await expect(member.updateColumn("age", 7)).rejects.toThrow(RecordDestroyed);
    });
  });

  describe("incrementColumn", () => {
    test("refuses an amount that isn't a number, sending nothing", async () => {
      const member = await db().model(Member).find(1);
      events.length = 0;

      await expect(member.incrementColumn("age", untyped("5"))).rejects.toThrow(TypeError);
      expect(member.changes()).toEqual({});
      expect(events).toEqual([]);
    });

    test("adds to the row's value, and holds the value the row now has", async () => {
      const member = await db().model(Member).find(1);
      member.email = "changed@example.com";
      events.length = 0;

      expect(await member.incrementColumn("age")).toBe(true);

      expect(member.age).toBe(4);
      expect(member.changes()).toEqual({ email: ["a@example.com", "changed@example.com"] });
      expect(events.length).toBe(1);
      expect((await db().model(Member).find(1)).age).toBe(4);
    });

    test("adds to what the row holds, so two copies of a record both count", async () => {
      const first = await db().model(Member).find(1);
      const second = await db().model(Member).find(1);

      await first.incrementColumn("age", 2);
      await second.incrementColumn("age", 2);

      expect(second.age).toBe(7);
      expect((await db().model(Member).find(1)).age).toBe(7);
    });

    test("sends an unsaved change to the attribute with the increment, as Rails", async () => {
      const member = await db().model(Member).find(1);
      member.age = 10;

      await member.incrementColumn("age");

      expect(member.age).toBe(11);
      expect((await db().model(Member).find(1)).age).toBe(11);
    });

    test("counts a null as zero", async () => {
      await harness.exec("UPDATE users SET age = NULL");
      const member = await db().model(Member).find(1);

      await member.incrementColumn("age", 3);

      expect((await db().model(Member).find(1)).age).toBe(3);
    });

    test("decrementColumn takes from the row's value", async () => {
      const member = await db().model(Member).find(1);

      expect(await member.decrementColumn("age", 2)).toBe(true);

      expect(member.age).toBe(1);
      expect((await db().model(Member).find(1)).age).toBe(1);
    });

    test("runs no validation or callback, and leaves updatedAt alone", async () => {
      const member = await db().model(Member).find(1);

      await member.incrementColumn("age", 500);

      expect(callbacks).toEqual([]);
      expect((await db().model(Member).find(1)).updatedAt).toBeNull();
    });

    test("resolves to false when the row is gone", async () => {
      const member = await db().model(Member).find(1);
      await harness.exec("DELETE FROM users");

      expect(await member.incrementColumn("age")).toBe(false);
      expect(member.age).toBe(4);
      expect(member.isChanged()).toBe(false);
    });

    test("refuses a new record with RecordNotSaved", async () => {
      const unsaved = db().model(Member).build({ email: "b@example.com" });

      await expect(unsaved.incrementColumn("age")).rejects.toThrow(RecordNotSaved);
      expect(events).toEqual([]);
    });

    test("refuses an attribute that isn't a number, sending nothing", async () => {
      const member = await db().model(Member).find(1);
      events.length = 0;

      await expect(member.incrementColumn(untyped("email"))).rejects.toThrow(TypeError);
      expect(events).toEqual([]);
    });
  });

  describe("toggleColumn", () => {
    test("writes the flipped boolean straight to the row, running no callback", async () => {
      const member = await db().model(Member).find(1);

      expect(await member.toggleColumn("isActive")).toBe(true);

      expect(member.isActive).toBe(false);
      expect(member.isChanged()).toBe(false);
      expect(callbacks).toEqual([]);
      expect((await db().model(Member).find(1)).isActive).toBe(false);
    });

    test("refuses a new record before flipping anything", async () => {
      const unsaved = db().model(Member).build({ email: "b@example.com" });

      await expect(unsaved.toggleColumn("isActive")).rejects.toThrow(RecordNotSaved);
      expect(unsaved.isActive).toBeNull();
      expect(events).toEqual([]);
    });

    test("refuses an attribute that isn't a boolean, sending nothing", async () => {
      const member = await db().model(Member).find(1);
      events.length = 0;

      await expect(member.toggleColumn(untyped("age"))).rejects.toThrow(TypeError);
      expect(events).toEqual([]);
    });
  });

  describe("updateCounters", () => {
    const ages = async () =>
      (await db().model(Member).order({ id: "asc" }).pluck("age")) as unknown[];
    beforeEach(async () => {
      await harness.exec(
        "INSERT INTO users (id, email, is_active) VALUES (2, 'b@example.com', ?)",
        [false],
      );
      events.length = 0;
    });

    test("adds to a Relation's rows in one statement, a null counting as zero", async () => {
      const members = db()
        .model(Member)
        .where({ id: [1, 2] });

      expect(await members.updateCounters({ age: 2, suspended: 1 })).toBe(2);

      expect(events.length).toBe(1);
      expect(await ages()).toEqual([5, 2]);
      expect(await db().model(Member).order({ id: "asc" }).pluck("suspended")).toEqual([1, 1]);
    });

    test("leaves updatedAt alone", async () => {
      await db().model(Member).updateCounters({ age: 1 });

      expect(await db().model(Member).pluck("updatedAt")).toEqual([null, null]);
    });

    test("a Model's static takes primary keys, and a negative number takes away", async () => {
      expect(await withDatabase(db(), () => Member.updateCounters(1, { age: -1 }))).toBe(1);
      expect(await withDatabase(db(), () => Member.updateCounters([1, 2], { age: 1 }))).toBe(2);

      expect(await ages()).toEqual([3, 1]);
    });

    test("incrementCounter adds one, or by, to one attribute of the rows with these keys", async () => {
      expect(await withDatabase(db(), () => Member.incrementCounter("age", 1))).toBe(1);
      expect(await withDatabase(db(), () => Member.incrementCounter("age", [1, 2], 3))).toBe(2);

      expect(await ages()).toEqual([7, 3]);
    });

    test("decrementCounter takes one, or by", async () => {
      expect(await withDatabase(db(), () => Member.decrementCounter("age", 1))).toBe(1);
      expect(await withDatabase(db(), () => Member.decrementCounter("age", 1, 2))).toBe(1);

      expect(await ages()).toEqual([0, null]);
    });

    test("a Model's static writes a row its default scope leaves out, as Rails", async () => {
      expect(await withDatabase(db(), () => ActiveMember.updateCounters(2, { age: 4 }))).toBe(1);

      expect(await ages()).toEqual([3, 4]);
    });

    test("refuses no counters with a TypeError, sending nothing", async () => {
      await expect(db().model(Member).updateCounters({})).rejects.toThrow(TypeError);
      expect(events).toEqual([]);
    });

    test("refuses an attribute that isn't a number, sending nothing", async () => {
      const counters = { email: 1 } as never;

      await expect(db().model(Member).updateCounters(counters)).rejects.toThrow(TypeError);
      expect(events).toEqual([]);
    });

    test("refuses an amount that isn't a number, sending nothing", async () => {
      const members = db().model(Member);

      await expect(members.updateCounters({ age: untyped(null) })).rejects.toThrow(TypeError);
      expect(events).toEqual([]);
    });

    // A guard: updateCounters is an updateAll, which sends nothing for none().
    test("a none() Relation sends nothing and resolves to 0", async () => {
      expect(await db().model(Member).none().updateCounters({ age: 1 })).toBe(0);
      expect(events).toEqual([]);
    });
  });

  describe("isPreviouslyNewRecord", () => {
    test("is true once a save created the record, its after-callbacks included", async () => {
      const member = db().model(Member).build({ email: "b@example.com", id: 2, age: 1 });
      expect(member.isPreviouslyNewRecord()).toBe(false);

      await member.save();

      expect(previouslyNew).toEqual([true]);
      expect(member.isPreviouslyNewRecord()).toBe(true);
    });

    test("is false for a loaded record", async () => {
      const member = await db().model(Member).find(1);

      expect(member.isPreviouslyNewRecord()).toBe(false);
    });

    test("is false after a later save, an update or a clean one", async () => {
      const created = await db().model(Member).create({ email: "b@example.com", id: 2, age: 1 });

      await created.update({ age: 5 });
      await created.save();

      expect(previouslyNew).toEqual([true, false, false]);
      expect(created.isPreviouslyNewRecord()).toBe(false);
    });

    test("is false once the record is destroyed", async () => {
      const member = await db().model(Member).create({ email: "b@example.com", id: 2, age: 1 });

      await member.destroy();

      expect(member.isPreviouslyNewRecord()).toBe(false);
    });
  });
});
