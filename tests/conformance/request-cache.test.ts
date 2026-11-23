import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import type { AnyDatabase } from "../../packages/active-record/src/database.ts";
import { withDatabase } from "../../packages/active-record/src/index.ts";
import type { QueryEvent } from "../../packages/active-record/src/executor.ts";
import { Model } from "../../packages/active-record/src/index.ts";
import { User } from "../fixtures/models/user.ts";
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
});
