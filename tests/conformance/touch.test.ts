import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { Model } from "../../packages/active-record/src/index.ts";
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
});
