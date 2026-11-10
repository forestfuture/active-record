import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import {
  belongsTo,
  hasMany,
  hasOne,
  Model,
  withDatabase,
} from "../../../packages/active-record/src/index.ts";
import { connect, d1 } from "../../../packages/active-record/src/adapters/d1/index.ts";
import { createTestDatabase, type TestDatabase } from "../../support/d1.ts";

// Level 1 reads the Worker's bindings from cloudflare:workers; here they're this test's two D1s.
const workers: { env: Record<string, unknown> } = { env: {} };
vi.mock("cloudflare:workers", () => workers);

/** An app's base class for the DB binding. */
abstract class DbRecord extends Model {
  static override schema = { adapter: d1({ binding: "DB" }), tables: {}, models: {} };
}

/** An app's base class for the LOGS binding. */
abstract class LogsRecord extends Model {
  static override schema = { adapter: d1({ binding: "LOGS" }), tables: {}, models: {} };
}

class User extends DbRecord.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
}) {
  static override table = "users";

  entries = hasMany(Entry);
  badge = hasOne(Badge);
}

class Entry extends LogsRecord.define({
  id: { type: "integer", null: false },
  userId: "integer",
  message: { type: "string", null: false },
}) {
  static override table = "entries";

  user = belongsTo(User);
  notes = hasMany(Note);
}

class Badge extends LogsRecord.define({
  id: { type: "integer", null: false },
  userId: "integer",
  label: { type: "string", null: false },
}) {
  static override table = "badges";
}

class Note extends DbRecord.define({
  id: { type: "integer", null: false },
  entryId: "integer",
  body: { type: "string", null: false },
}) {
  static override table = "notes";
}

const schema = new URL("../../fixtures/cross-database/schema.sql", import.meta.url);

let db: TestDatabase;
let logs: TestDatabase;
const disposals: (() => Promise<void>)[] = [];

beforeAll(async () => {
  for (const each of ["DB", "LOGS"]) {
    const { db: binding, dispose } = await createTestDatabase(schema);
    disposals.push(dispose);
    if (each === "DB") db = binding;
    else logs = binding;
  }
  workers.env = { DB: db, LOGS: logs };
});
afterAll(async () => {
  for (const dispose of disposals) await dispose();
});

// Each database holds a row of every table, so a read on the wrong one finds a decoy.
beforeEach(async () => {
  for (const [binding, where] of [
    [db, "DB"],
    [logs, "LOGS"],
  ] as const) {
    await binding.batch([
      ...["users", "entries", "badges", "notes"].map((table) =>
        binding.prepare(`DELETE FROM ${table}`),
      ),
      binding.prepare("INSERT INTO users (id, email) VALUES (1, ?)").bind(`ada@${where}`),
      binding.prepare("INSERT INTO entries (id, user_id, message) VALUES (1, 1, ?)").bind(where),
      binding.prepare("INSERT INTO badges (id, user_id, label) VALUES (1, 1, ?)").bind(where),
      binding.prepare("INSERT INTO notes (id, entry_id, body) VALUES (1, 1, ?)").bind(where),
    ]);
  }
});

/** `fn`, in a request with both databases. */
function inRequest<R>(fn: () => Promise<R>): Promise<R> {
  return withDatabase([connect(db), connect(logs)], fn);
}

describe("reading an association to another database", () => {
  test("a belongsTo reads its target's database", async () => {
    const email = await inRequest(async () => (await (await Entry.find(1)).user())?.email);

    expect(email).toBe("ada@DB");
  });

  test("a hasMany reads its target's database", async () => {
    const messages = await inRequest(async () => (await User.find(1)).entries().pluck("message"));

    expect(messages).toEqual(["LOGS"]);
  });

  test("a hasOne reads its target's database", async () => {
    const label = await inRequest(async () => (await (await User.find(1)).badge())?.label);

    expect(label).toBe("LOGS");
  });

  test("a hasMany's counts and conditions read its target's database", async () => {
    const counts = await inRequest(async () => {
      const entries = (await User.find(1)).entries();
      return [await entries.count(), await entries.where({ message: "LOGS" }).exists()];
    });

    expect(counts).toEqual([1, true]);
  });

  test("with no request database, the target is read from its own binding", async () => {
    const entry = await Entry.find(1);

    expect((await entry.user())?.email).toBe("ada@DB");
  });

  test("an owner from an explicit database reads its target from the target's binding", async () => {
    const entry = await connect(logs).model(Entry).find(1);

    expect((await entry.user())?.email).toBe("ada@DB");
  });

  test("a target loaded from another database reads its own associations there", async () => {
    const bodies = await inRequest(async () => {
      const entry = await (await User.find(1)).entries().first();
      return entry?.notes().pluck("body");
    });

    expect(bodies).toEqual(["DB"]);
  });
});

/** The rows of `sql` on `binding`, read past the library. */
async function rows(binding: TestDatabase, sql: string): Promise<Record<string, unknown>[]> {
  return (await binding.prepare(sql).all()).results;
}

describe("writing through an association to another database", () => {
  test("creating through a hasMany writes the record to the target's database", async () => {
    await inRequest(async () => (await User.find(1)).entries().create({ id: 2, message: "new" }));

    expect(await rows(logs, "SELECT user_id FROM entries WHERE id = 2")).toEqual([{ user_id: 1 }]);
    expect(await rows(db, "SELECT id FROM entries WHERE id = 2")).toEqual([]);
  });

  test("creating through a hasOne writes the record to the target's database", async () => {
    await inRequest(async () => (await User.find(1)).badge.create({ id: 2, label: "new" }));

    expect(await rows(logs, "SELECT user_id FROM badges WHERE id = 2")).toEqual([{ user_id: 1 }]);
    expect(await rows(db, "SELECT id FROM badges WHERE id = 2")).toEqual([]);
  });

  test("creating through a belongsTo writes the record to the target's database", async () => {
    const userId = await inRequest(async () => {
      const entry = await Entry.find(1);
      await entry.user.create({ id: 2, email: "grace@DB" });
      return entry.userId;
    });

    expect(userId).toBe(2);
    expect(await rows(db, "SELECT email FROM users WHERE id = 2")).toEqual([{ email: "grace@DB" }]);
    expect(await rows(logs, "SELECT id FROM users WHERE id = 2")).toEqual([]);
  });

  test("a record loaded through the association saves to the target's database", async () => {
    await inRequest(async () => {
      const entry = await (await User.find(1)).entries().first();
      await entry!.update({ message: "changed" });
    });

    expect(await rows(logs, "SELECT message FROM entries")).toEqual([{ message: "changed" }]);
    expect(await rows(db, "SELECT message FROM entries")).toEqual([{ message: "DB" }]);
  });

  test("a bulk write through a hasMany goes to the target's database", async () => {
    await inRequest(async () => (await User.find(1)).entries().updateAll({ message: "bulk" }));

    expect(await rows(logs, "SELECT message FROM entries")).toEqual([{ message: "bulk" }]);
    expect(await rows(db, "SELECT message FROM entries")).toEqual([{ message: "DB" }]);
  });
});
