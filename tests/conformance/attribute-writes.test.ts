import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { Model, RecordDestroyed, RecordNotSaved } from "../../packages/active-record/src/index.ts";
import type { QueryEvent } from "../../packages/active-record/src/executor.ts";
import { openHarness, type Harness } from "../support/harness.ts";

class Member extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  age: "integer",
  isActive: "boolean",
  updatedAt: "datetime",
}) {
  static table = "users";

  static {
    this.validates("age", { numericality: { lessThan: 100 } });
    for (const kind of ["beforeValidation", "beforeSave", "afterSave", "afterCommit"] as const) {
      this[kind](() => void callbacks.push(kind));
    }
  }
}

/** The callbacks Member's records ran. */
const callbacks: string[] = [];

/** A name the method's type refuses, as one from untyped code would arrive. */
const untyped = (name: string) => name as never;

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
});
