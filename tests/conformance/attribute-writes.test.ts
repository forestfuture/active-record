import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { Model } from "../../packages/active-record/src/index.ts";
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
}

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
});
