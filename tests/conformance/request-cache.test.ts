import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import type { AnyDatabase } from "../../packages/active-record/src/database.ts";
import type { Driver } from "../../packages/active-record/src/driver.ts";
import type { QueryEvent } from "../../packages/active-record/src/executor.ts";
import { Model, sql, withDatabase } from "../../packages/active-record/src/index.ts";
import { User } from "../fixtures/models/user.ts";
import { holdStatements, reads } from "../support/hold-statements.ts";
import { openHarness, type Harness } from "../support/harness.ts";

class Attachment extends Model.define({
  id: { type: "integer", null: false },
  name: "string",
  data: "binary",
}) {
  static table = "attachments";
}

// The request cache (#218): inside one withDatabase call, a read identical to one already sent
// on that Database is answered from memory.
describe("the request cache", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());

  const events: QueryEvent[] = [];
  const db = () => harness.connect({ onQuery: (event) => events.push(event) });
  beforeEach(async () => {
    events.length = 0;
    await harness.reset("posts", "users", "attachments");
    await harness.exec("INSERT INTO users (id, email) VALUES (1, 'jane@example.com')");
  });

  test("answers the same find twice with one statement, the second reported as cached", async () => {
    const database = db();
    const users = database.model(User);
    const [first, second] = await withDatabase(database, async () => [
      await users.find(1),
      await users.find(1),
    ]);

    expect(first.email).toBe("jane@example.com");
    expect(second.email).toBe("jane@example.com");
    expect(events.map(({ cached }) => cached)).toEqual([undefined, true]);
    const [sent, cached] = events as [QueryEvent, QueryEvent];
    expect(cached).toEqual({
      model: "User",
      sql: sent.sql,
      params: sent.params,
      durationMs: 0,
      cached: true,
    });
  });

  describe("a write on the Database clears it, so the next read is sent", () => {
    const writes: [string, (database: AnyDatabase) => Promise<unknown>][] = [
      [
        "a save",
        async (database) =>
          (await database.model(User).find(1)).update({ email: "sam@example.com" }),
      ],
      ["a destroy", async (database) => (await database.model(User).find(1)).destroy()],
      [
        "a bulk write",
        (database) => database.model(User).where({ id: 1 }).updateAll({ email: "sam@example.com" }),
      ],
      [
        "a batch",
        (database) => database.batch((b) => [b.insert(User, { id: 2, email: "sam@example.com" })]),
      ],
      [
        "a write that fails",
        (database) =>
          database
            .model(User)
            .create({ id: 1, email: "jane@example.com" })
            .catch(() => undefined),
      ],
    ];

    test.each(writes)("%s", async (_, write) => {
      const database = db();
      const janes = database.model(User).where({ email: "jane@example.com" });
      await withDatabase(database, async () => {
        await janes.toArray();
        await write(database);
        events.length = 0;
        await janes.toArray();
      });

      expect(events.map(({ cached }) => cached)).toEqual([undefined]);
    });
  });

  test("cache: { request: false } turns it off: each read is sent", async () => {
    const database = harness.connect({
      onQuery: (event) => events.push(event),
      cache: { request: false },
    });
    const users = database.model(User);
    await withDatabase(database, async () => {
      await users.find(1);
      await users.find(1);
    });

    expect(events.map(({ cached }) => cached)).toEqual([undefined, undefined]);
  });

  // A guard: a cell is converted into a new value for each record, so the answers share none.
  test("each answer is new records: changing one, or its bytes, changes no other", async () => {
    const database = db();
    const { id } = await database
      .model(Attachment)
      .create({ name: "a.bin", data: new Uint8Array([1, 2]) });
    const attachments = database.model(Attachment);

    const second = await withDatabase(database, async () => {
      const first = await attachments.find(id);
      first.name = "b.bin";
      first.data![0] = 9;
      return attachments.find(id);
    });

    expect(events.at(-1)?.cached).toBe(true);
    expect([second.name, [...second.data!]]).toEqual(["a.bin", [1, 2]]);
  });

  // A guard: every read of one statement goes through the same path.
  test.each([
    ["where", (database: AnyDatabase) => database.model(User).where({ id: 1 }).toArray()],
    ["count", (database: AnyDatabase) => database.model(User).count()],
    ["pluck", (database: AnyDatabase) => database.model(User).pluck("email")],
    ["exists", (database: AnyDatabase) => database.model(User).exists({ id: 1 })],
    [
      "an association read",
      async (database: AnyDatabase) => {
        const user = await database.model(User).find(1);
        return user.posts().toArray();
      },
    ],
  ])("caches %s", async (_, read) => {
    const database = db();
    await withDatabase(database, async () => {
      await read(database);
      events.length = 0;
      await read(database);
    });

    expect(events.length).toBeGreaterThan(0);
    expect(events.every(({ cached }) => cached)).toBe(true);
  });

  test("reload() reads the database and clears the cache, so the read after it is sent", async () => {
    const database = db();
    const users = database.model(User);
    await withDatabase(database, async () => {
      const user = await users.find(1);
      await users.count();
      await harness.exec("UPDATE users SET email = 'sam@example.com' WHERE id = 1");
      events.length = 0;
      await user.reload();
      expect(user.email).toBe("sam@example.com");
      await users.count();
    });

    expect(events.map(({ cached }) => cached)).toEqual([undefined, undefined]);
  });

  test("reload() of a record from a Database the call wasn't given clears it", async () => {
    const database = db();
    const users = database.model(User);
    const counted = await withDatabase(database, async () => {
      await users.count();
      const user = await harness.connect().model(User).find(1);
      await user.reload();
      events.length = 0;
      await users.count();
      return events.map(({ cached }) => cached);
    });

    expect(counted).toEqual([undefined]);
  });

  describe("batch iteration", () => {
    beforeEach(async () => {
      await harness.exec("INSERT INTO users (id, email) VALUES (2, 'sam@example.com')");
    });

    test("doesn't keep its batches, so walking a table again sends each batch", async () => {
      const database = db();
      const users = database.model(User);
      const walk = async () => {
        for await (const batch of users.findInBatches({ batchSize: 1 })) void batch;
      };

      const cached = await withDatabase(database, async () => {
        await walk();
        events.length = 0;
        await walk();
        return events.map((event) => event.cached);
      });

      expect(cached).toEqual([undefined, undefined, undefined]);
    });

    test("still caches the reads its callback sends", async () => {
      const database = db();
      const users = database.model(User);

      const cached = await withDatabase(database, async () => {
        for await (const user of users.findEach({ batchSize: 2 })) void user;
        await users.find(1);
        events.length = 0;
        for await (const user of users.findEach({ batchSize: 2 })) await users.find(user.id);
        return events.map((event) => event.cached);
      });

      // The first batch, the callback's two finds (the first one cached), then the short last batch.
      expect(cached).toEqual([undefined, true, undefined, undefined]);
    });
  });

  // A guard: only a running withDatabase scope has a cache.
  describe("isn't kept", () => {
    const twoFinds = async (database: AnyDatabase) => {
      await database.model(User).find(1);
      await database.model(User).find(1);
    };

    test("outside withDatabase", async () => {
      await twoFinds(db());

      expect(events.map(({ cached }) => cached)).toEqual([undefined, undefined]);
    });

    test("for a Database the withDatabase call wasn't given", async () => {
      const other = db();
      await withDatabase(db(), () => twoFinds(other));

      expect(events.map(({ cached }) => cached)).toEqual([undefined, undefined]);
    });

    test("once the withDatabase call has returned, for work it started (a waitUntil's)", async () => {
      const database = db();
      let returned!: () => void;
      const hasReturned = new Promise<void>((resolve) => (returned = resolve));
      let later: Promise<void> | undefined;
      await withDatabase(database, async () => {
        await database.model(User).find(1);
        later = hasReturned.then(() => twoFinds(database));
      });
      returned();
      await later;

      expect(events.map(({ cached }) => cached)).toEqual([undefined, undefined, undefined]);
    });

    test("across two withDatabase calls with one Database, even at once", async () => {
      const database = db();
      await Promise.all([
        withDatabase(database, () => database.model(User).find(1)),
        withDatabase(database, () => database.model(User).find(1)),
      ]);
      await withDatabase(database, () => database.model(User).find(1));

      expect(events.map(({ cached }) => cached)).toEqual([undefined, undefined, undefined]);
    });
  });

  describe("a read in flight", () => {
    test("is shared by an identical read sent meanwhile", async () => {
      const database = db();
      const users = database.model(User);
      const found = await withDatabase(database, () => Promise.all([users.find(1), users.find(1)]));

      expect(found.map(({ email }) => email)).toEqual(["jane@example.com", "jane@example.com"]);
      expect(events.map(({ cached }) => cached)).toEqual([undefined, true]);
    });

    test("sent while a write is in flight isn't kept, so the read after the write is sent", async () => {
      // The UPDATE is held before it runs, so a read lands first, with the rows before it.
      const isUpdate = (sql: string) => sql.startsWith("UPDATE");
      const {
        db: database,
        arm,
        held,
        release,
      } = holdStatements(harness, isUpdate, "beforeRunning");
      const users = database.model(User);

      arm();
      const email = await withDatabase(database, async () => {
        const write = users.where({ id: 1 }).updateAll({ email: "sam@example.com" });
        await held;
        await users.find(1);
        release();
        await write;
        return (await users.find(1)).email;
      });

      expect(email).toBe("sam@example.com");
    });

    test("sent while a batch of writes is in flight isn't kept", async () => {
      // The batch is held before it's sent, so a read lands first, with the rows before it.
      let release!: () => void;
      const released = new Promise<void>((resolve) => (release = resolve));
      let isHeld!: () => void;
      const held = new Promise<void>((resolve) => (isHeld = resolve));
      const holdingBatches = (driver: Driver): Driver => ({
        read: (statements) => driver.read(statements),
        send: (statement) => driver.send(statement),
        recover: (error) => driver.recover(error),
        async write(statements) {
          isHeld();
          await released;
          return driver.write(statements);
        },
      });
      const database = harness.connect({ driver: holdingBatches });
      const users = database.model(User);

      const email = await withDatabase(database, async () => {
        const write = database.batch((b) => [
          b.insert(User, { id: 2, email: "alex@example.com" }),
          b.updateAll(users.where({ id: 1 }), { email: "sam@example.com" }),
        ]);
        await held;
        await users.find(1);
        release();
        await write;
        return (await users.find(1)).email;
      });

      expect(email).toBe("sam@example.com");
    });

    test("isn't kept when a write clears the cache before it's answered", async () => {
      // The first users read is held once it has run, until the write is done.
      const {
        db: database,
        arm,
        held,
        release,
      } = holdStatements(harness, reads("users"), "afterRunning");
      const users = database.model(User);

      arm();
      const email = await withDatabase(database, async () => {
        const stale = users.find(1);
        await held;
        await users.where({ id: 1 }).updateAll({ email: "sam@example.com" });
        release();
        await stale;
        return (await users.find(1)).email;
      });

      expect(email).toBe("sam@example.com");
    });
  });

  describe("in a read group (a preload's queries, sent at once)", () => {
    test("answers each statement it has, and sends the rest together", async () => {
      await harness.exec("INSERT INTO posts (id, user_id, title) VALUES (1, 1, 'Hello')");
      const database = db();
      const users = database.model(User);
      const loaded = await withDatabase(database, async () => {
        await users.toArray();
        events.length = 0;
        return users.includes("posts").toArray();
      });

      expect(loaded.map((user) => user.loaded("posts").map(({ title }) => title))).toEqual([
        ["Hello"],
      ]);
      expect(events.map(({ cached }) => cached)).toEqual([true, undefined]);
    });

    test("that fails, binding a value the cache can't key, leaves no rejection unhandled", async () => {
      const failing = (driver: Driver): Driver => ({
        send: (statement) => driver.send(statement),
        write: (statements) => driver.write(statements),
        recover: () => false,
        read: () => Promise.reject(new Error("the database went away")),
      });
      const database = harness.connect({ driver: failing });
      const users = database
        .model(User)
        .where(sql`id <> ${1n}`)
        .includes("posts");

      const loading = withDatabase(database, () => users.toArray());

      await expect(loading).rejects.toThrow("the database went away");
    });

    test("is answered from memory when it's sent again", async () => {
      const database = db();
      const users = database.model(User).includes("posts");
      await withDatabase(database, async () => {
        await users.toArray();
        events.length = 0;
        await users.toArray();
      });

      expect(events.map(({ cached }) => cached)).toEqual([true, true]);
    });
  });

  test("keeps 100 answers, forgetting the least recently used first", async () => {
    const database = db();
    const byId = (id: number) => database.model(User).where({ id }).toArray();
    const cached = await withDatabase(database, async () => {
      for (let id = 1; id <= 100; id++) await byId(id);
      await byId(1);
      await byId(101);
      events.length = 0;
      await byId(1);
      await byId(2);
      return events.map((event) => event.cached);
    });

    expect(cached).toEqual([true, undefined]);
  });

  describe("a read binding a value the cache can't key", () => {
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;

    test.each([
      ["a BigInt", 1n],
      ["a cycle", circular],
    ])("with %s, has the outcome it has outside withDatabase", async (_, value) => {
      const database = db();
      const read = () =>
        database
          .model(User)
          .where(sql`id = ${value}`)
          .pluck("email")
          .then(
            (emails) => ({ emails }),
            (error: Error) => ({ error: error.message }),
          );
      const outside = await read();

      const inside = await withDatabase(database, async () => [await read(), await read()]);

      expect(inside).toEqual([outside, outside]);
    });

    test("two reads binding different bytes, as an ArrayBuffer, answer as they do uncached", async () => {
      const database = db();
      const attachments = database.model(Attachment);
      await attachments.create({ name: "a.bin", data: new Uint8Array([1]) });
      const named = (bytes: number[]) =>
        attachments.where(sql`data = ${new Uint8Array(bytes).buffer}`).pluck("name");

      const outside = [await named([1]), await named([2])];

      const inside = await withDatabase(database, async () => [await named([1]), await named([2])]);

      expect(inside).toEqual(outside);
    });
  });

  describe("is cleared by a write through another Database inside the call", () => {
    test("one on the same database that withDatabase wasn't given", async () => {
      const database = db();
      const other = harness.connect();
      const users = database.model(User);
      const email = await withDatabase(database, async () => {
        await users.find(1);
        await other.model(User).where({ id: 1 }).updateAll({ email: "sam@example.com" });
        return (await users.find(1)).email;
      });

      expect(email).toBe("sam@example.com");
    });

    test("a record saved on it", async () => {
      const database = db();
      const other = harness.connect();
      const users = database.model(User);
      const email = await withDatabase(database, async () => {
        await users.find(1);
        const user = await other.model(User).find(1);
        await user.update({ email: "sam@example.com" });
        return (await users.find(1)).email;
      });

      expect(email).toBe("sam@example.com");
    });
  });

  test("a nested call's is cleared by a write the outer call sends while it runs", async () => {
    const outer = db();
    const inner = db();
    let hasRead!: () => void;
    const read = new Promise<void>((resolve) => (hasRead = resolve));
    let hasWritten!: () => void;
    const written = new Promise<void>((resolve) => (hasWritten = resolve));

    const email = await withDatabase(outer, async () => {
      const nested = withDatabase(inner, async () => {
        await inner.model(User).find(1);
        hasRead();
        await written;
        return (await inner.model(User).find(1)).email;
      });
      await read;
      await outer.model(User).where({ id: 1 }).updateAll({ email: "sam@example.com" });
      hasWritten();
      return nested;
    });

    expect(email).toBe("sam@example.com");
  });

  describe("db.clearRequestCache()", () => {
    test("empties it, so a read after a write the library didn't send is sent", async () => {
      const database = db();
      const users = database.model(User);
      const email = await withDatabase(database, async () => {
        await users.find(1);
        await harness.exec("UPDATE users SET email = 'sam@example.com' WHERE id = 1");
        database.clearRequestCache();
        return (await users.find(1)).email;
      });

      expect(email).toBe("sam@example.com");
      expect(events.map(({ cached }) => cached)).toEqual([undefined, undefined]);
    });

    test("on a Database the call wasn't given empties the call's", async () => {
      const database = db();
      const users = database.model(User);
      const email = await withDatabase(database, async () => {
        await users.find(1);
        await harness.exec("UPDATE users SET email = 'sam@example.com' WHERE id = 1");
        harness.connect().clearRequestCache();
        return (await users.find(1)).email;
      });

      expect(email).toBe("sam@example.com");
    });

    test("does nothing outside withDatabase", () => {
      expect(() => db().clearRequestCache()).not.toThrow();
    });
  });

  test("caches a read by a filtered attribute, keyed by its real value", async () => {
    const database = db();
    const byEmail = (email: string) => database.model(User).findBy({ email });

    const found = await withDatabase(database, async () => [
      await byEmail("jane@example.com"),
      await byEmail("sam@example.com"),
      await byEmail("jane@example.com"),
    ]);

    expect(found.map((user) => user?.email ?? null)).toEqual([
      "jane@example.com",
      null,
      "jane@example.com",
    ]);
    expect(events.map(({ cached }) => cached)).toEqual([undefined, undefined, true]);
  });
});
