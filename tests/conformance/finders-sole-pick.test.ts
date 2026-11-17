import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import type { QueryEvent } from "../../packages/active-record/src/executor.ts";
import { User } from "../fixtures/models/user.ts";
import { openHarness, type Harness } from "../support/harness.ts";

describe("pick, ids, sole and the OrThrow finders (#349)", () => {
  let harness: Harness;
  const events: QueryEvent[] = [];
  const users = () => harness.connect({ onQuery: (event) => events.push(event) }).model(User);

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.reset("users", "posts");
    events.length = 0;
  });

  const seed = async (...rows: [id: number, email: string, age: number | null][]) => {
    for (const row of rows) {
      await harness.exec("INSERT INTO users (id, email, age) VALUES (?, ?, ?)", row);
    }
    events.length = 0;
  };

  /** User 1, with its posts loaded: `titles` in id order. */
  const withLoadedPosts = async (...titles: string[]) => {
    await seed([1, "a@example.com", 30]);
    for (const [index, title] of titles.entries()) {
      await harness.exec("INSERT INTO posts (id, user_id, title) VALUES (?, 1, ?)", [
        index + 10,
        title,
      ]);
    }
    const user = await users().find(1);
    await user.posts().toArray();
    events.length = 0;
    return user;
  };

  describe("pick", () => {
    test("is null with no rows", async () => {
      expect(await users().pick("email")).toBeNull();
    });

    test("is the one row's value", async () => {
      await seed([1, "a@example.com", 30]);

      expect(await users().pick("email")).toBe("a@example.com");
    });

    test("is the first row's value in the Relation's order, with one query for one row", async () => {
      await seed([1, "b@example.com", 30], [2, "c@example.com", 20], [3, "a@example.com", 40]);

      expect(await users().order({ email: "asc" }).pick("email")).toBe("a@example.com");
      expect(await users().order({ age: "asc" }).pick("age")).toBe(20);
      expect(events).toHaveLength(2);
      expect(events.map((event) => event.params.at(-1))).toEqual([1, 1]);
    });

    test("on a loaded hasMany, answers from its records without a query", async () => {
      const user = await withLoadedPosts("First", "Second");

      expect(await user.posts().pick("title")).toBe("First");
      expect(events).toHaveLength(0);
    });
  });
});
