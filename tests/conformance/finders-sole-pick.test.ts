import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import type { QueryEvent } from "../../packages/active-record/src/executor.ts";
import { RecordNotFound, SoleRecordExceeded } from "../../packages/active-record/src/index.ts";
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
    await harness.reset("posts", "users");
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

    test("is the first row's value in the Relation's order, asking for one row", async () => {
      await seed([1, "b@example.com", 30], [2, "c@example.com", 20], [3, "a@example.com", 40]);

      expect(await users().order({ email: "asc" }).pick("email")).toBe("a@example.com");
      expect(await users().order({ age: "asc" }).pick("age")).toBe(20);
      expect(events).toHaveLength(2);
      expect(events.map((event) => event.params.at(-1))).toEqual([1, 1]);
    });

    test("with several attributes, is the first row's tuple in the Relation's order, or null", async () => {
      expect(await users().pick("email", "age")).toBeNull();

      await seed([1, "b@example.com", 30], [2, "c@example.com", 20]);

      expect(await users().order({ age: "asc" }).pick("email", "age")).toEqual([
        "c@example.com",
        20,
      ]);
    });

    test("on a loaded hasMany, answers from its records without a query", async () => {
      const user = await withLoadedPosts("First", "Second");

      expect(await user.posts().pick("title")).toBe("First");
      expect(events).toHaveLength(0);
    });
  });

  describe("ids", () => {
    test("is empty with no rows", async () => {
      expect(await users().ids()).toEqual([]);
    });

    test("is the one row's primary key", async () => {
      await seed([7, "a@example.com", 30]);

      expect(await users().ids()).toEqual([7]);
    });

    test("is each matching row's primary key in the Relation's order", async () => {
      await seed([1, "b@example.com", 30], [2, "c@example.com", 20], [3, "a@example.com", 40]);

      expect(await users().order({ email: "asc" }).ids()).toEqual([3, 1, 2]);
      expect(
        await users()
          .where({ age: [20, 40] })
          .order({ age: "desc" })
          .ids(),
      ).toEqual([3, 2]);
    });

    test("on a loaded hasMany, answers from its records without a query", async () => {
      const user = await withLoadedPosts("First", "Second");

      expect(await user.posts().ids()).toEqual([10, 11]);
      expect(events).toHaveLength(0);
    });
  });

  describe("sole", () => {
    test("throws RecordNotFound with no rows", async () => {
      await expect(users().sole()).rejects.toThrow(new RecordNotFound("User not found"));
    });

    test("is the one matching record, asking for two rows", async () => {
      await seed([1, "a@example.com", 30], [2, "b@example.com", 20]);

      const user = await users().where({ age: 20 }).sole();

      expect(user.email).toBe("b@example.com");
      expect(events.map((event) => event.params.at(-1))).toEqual([2]);
    });

    test("throws SoleRecordExceeded with several", async () => {
      await seed([1, "a@example.com", 30], [2, "b@example.com", 30]);

      await expect(users().where({ age: 30 }).sole()).rejects.toThrow(
        new SoleRecordExceeded("Wanted only one User"),
      );
    });

    test("counts a join's repeated rows, so a record joined twice is more than one", async () => {
      await withLoadedPosts("First", "Second");

      await expect(users().joins("posts").sole()).rejects.toThrow(SoleRecordExceeded);
    });

    test("on a loaded hasMany, answers from its records without a query", async () => {
      const user = await withLoadedPosts("Only");

      expect((await user.posts().sole()).title).toBe("Only");
      expect(events).toHaveLength(0);
    });
  });

  describe("findSoleBy", () => {
    test("throws RecordNotFound when none matches", async () => {
      await seed([1, "a@example.com", 30]);

      await expect(users().findSoleBy({ age: 20 })).rejects.toThrow(RecordNotFound);
    });

    test("is the one record matching the conditions", async () => {
      await seed([1, "a@example.com", 30], [2, "b@example.com", 20]);

      expect((await users().findSoleBy({ age: 20 })).email).toBe("b@example.com");
    });

    test("throws SoleRecordExceeded when several match", async () => {
      await seed([1, "a@example.com", 30], [2, "b@example.com", 30]);

      await expect(users().findSoleBy({ age: 30 })).rejects.toThrow(SoleRecordExceeded);
    });
  });

  describe("firstOrThrow, lastOrThrow and takeOrThrow", () => {
    test("throw RecordNotFound with no rows", async () => {
      const notFound = new RecordNotFound("User not found");

      await expect(users().firstOrThrow()).rejects.toThrow(notFound);
      await expect(users().lastOrThrow()).rejects.toThrow(notFound);
      await expect(users().takeOrThrow()).rejects.toThrow(notFound);
    });

    test("find the one row", async () => {
      await seed([1, "a@example.com", 30]);

      expect((await users().firstOrThrow()).id).toBe(1);
      expect((await users().lastOrThrow()).id).toBe(1);
      expect((await users().takeOrThrow()).id).toBe(1);
    });

    test("find what first, last and take find among several", async () => {
      await seed([1, "b@example.com", 30], [2, "c@example.com", 20], [3, "a@example.com", 40]);
      const byEmail = users().order({ email: "asc" });

      expect((await byEmail.firstOrThrow()).id).toBe(3);
      expect((await byEmail.lastOrThrow()).id).toBe(2);
      expect((await byEmail.takeOrThrow()).id).toBe(3);
      expect((await users().firstOrThrow()).id).toBe(1);
      expect((await users().lastOrThrow()).id).toBe(3);
    });

    test("on a loaded hasMany, answer from its records without a query", async () => {
      const user = await withLoadedPosts("First", "Second");

      expect((await user.posts().firstOrThrow()).title).toBe("First");
      expect((await user.posts().lastOrThrow()).title).toBe("Second");
      expect((await user.posts().takeOrThrow()).title).toBe("First");
      expect(events).toHaveLength(0);
    });
  });

  describe("within the Relation's page", () => {
    test("pick and sole keep the Relation's offset, and limit(0) finds nothing", async () => {
      await seed([1, "b@example.com", 30], [2, "c@example.com", 20], [3, "a@example.com", 40]);
      const byEmail = users().order({ email: "asc" });

      expect(await byEmail.offset(1).pick("email")).toBe("b@example.com");
      expect((await byEmail.offset(2).sole()).email).toBe("c@example.com");
      expect(await byEmail.limit(0).pick("email")).toBeNull();
      await expect(byEmail.limit(0).sole()).rejects.toThrow(RecordNotFound);
    });
  });

  describe("on none()", () => {
    test("pick is null, ids are empty, and the finders throw, with no query", async () => {
      await seed([1, "a@example.com", 30]);
      const none = users().none();

      expect(await none.pick("email")).toBeNull();
      expect(await none.ids()).toEqual([]);
      await expect(none.sole()).rejects.toThrow(RecordNotFound);
      await expect(none.findSoleBy({ age: 30 })).rejects.toThrow(RecordNotFound);
      await expect(none.firstOrThrow()).rejects.toThrow(RecordNotFound);
      expect(events).toHaveLength(0);
    });
  });
});
