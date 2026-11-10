import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import {
  batch,
  belongsTo,
  hasMany,
  hasOne,
  IncompatibleRelation,
  Model,
  RecordNotUnique,
  withDatabase,
} from "../../../packages/active-record/src/index.ts";
import {
  connect,
  d1,
  type QueryEvent,
} from "../../../packages/active-record/src/adapters/d1/index.ts";
import { createTestDatabase, type TestDatabase } from "../../support/d1.ts";

// Level 1 reads the Worker's bindings from cloudflare:workers; here they're this test's two D1s.
const workers: { env: Record<string, unknown> } = { env: {} };
vi.mock("cloudflare:workers", () => workers);

/** What the Models' callbacks ran, and where each write went, in order. */
const log: string[] = [];

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

  static {
    this.beforeSave((user) => void log.push(`before save ${user.email}`));
    this.afterSave((user) => void log.push(`after save ${user.email}`));
  }
}

class Entry extends LogsRecord.define({
  id: { type: "integer", null: false },
  userId: "integer",
  message: { type: "string", null: false },
}) {
  static override table = "entries";

  user = belongsTo(User);
  notes = hasMany(Note);

  static {
    this.validates("message", { presence: true });
    this.beforeSave((entry) => void log.push(`before save ${entry.message}`));
    this.afterSave((entry) => void log.push(`after save ${entry.message}`));
  }
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
  log.length = 0;
});

/** Logs each write a database is sent, by the database's binding. */
const writesTo =
  (binding: string) =>
  ({ sql }: QueryEvent): void => {
    if (!sql.startsWith("SELECT")) log.push(`write ${binding}`);
  };

/** `fn`, in a request with both databases, each logging its writes. */
function inRequest<R>(fn: () => Promise<R>): Promise<R> {
  const databases = [
    connect(db, { onQuery: writesTo("DB") }),
    connect(logs, { onQuery: writesTo("LOGS") }),
  ];
  return withDatabase(databases, fn);
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

describe("autosaving records on another database", () => {
  test("a hasMany's built records are written to their database", async () => {
    const saved = await inRequest(async () => {
      const user = User.build({ id: 2, email: "grace@DB" });
      user.entries().build({ id: 2, message: "built" });
      return user.save();
    });

    expect(saved).toBe(true);
    expect(await rows(db, "SELECT id FROM users WHERE id = 2")).toEqual([{ id: 2 }]);
    expect(await rows(logs, "SELECT user_id FROM entries WHERE id = 2")).toEqual([{ user_id: 2 }]);
  });

  test("a hasMany's built records take the key the database generates for the owner", async () => {
    const id = await inRequest(async () => {
      const user = User.build({ email: "grace@DB" });
      user.entries().build({ id: 2, message: "built" });
      await user.saveOrThrow();
      return user.id;
    });

    expect(await rows(logs, "SELECT user_id FROM entries WHERE id = 2")).toEqual([{ user_id: id }]);
  });

  test("a hasOne's built record is written to its database", async () => {
    await inRequest(async () => {
      const user = User.build({ id: 2, email: "grace@DB" });
      user.badge.build({ id: 2, label: "built" });
      await user.saveOrThrow();
    });

    expect(await rows(logs, "SELECT user_id FROM badges WHERE id = 2")).toEqual([{ user_id: 2 }]);
  });

  test("a new record a belongsTo points at is written to its database first", async () => {
    const id = await inRequest(async () => {
      const entry = Entry.build({ id: 2, message: "built" });
      const user = entry.user.build({ email: "grace@DB" });
      await entry.saveOrThrow();
      return user.id;
    });

    expect(await rows(db, `SELECT email FROM users WHERE id = ${id}`)).toEqual([
      { email: "grace@DB" },
    ]);
    expect(await rows(logs, "SELECT user_id FROM entries WHERE id = 2")).toEqual([{ user_id: id }]);
  });

  test("the owner's database is written first, after every before-callback", async () => {
    await inRequest(async () => {
      const user = User.build({ id: 2, email: "grace@DB" });
      user.entries().build({ id: 2, message: "built" });
      await user.saveOrThrow();
    });

    expect(log).toEqual([
      "before save grace@DB",
      "before save built",
      "write DB",
      "write LOGS",
      "after save grace@DB",
      "after save built",
    ]);
  });

  test("an invalid record on another database makes the owner invalid, writing nothing", async () => {
    const saved = await inRequest(async () => {
      const user = User.build({ id: 2, email: "grace@DB" });
      user.entries().build({ id: 2, message: "" });
      return user.save();
    });

    expect(saved).toBe(false);
    expect(await rows(db, "SELECT id FROM users WHERE id = 2")).toEqual([]);
    expect(await rows(logs, "SELECT id FROM entries WHERE id = 2")).toEqual([]);
  });

  test("a write the other database refuses leaves the owner saved and the record new", async () => {
    const outcome = await inRequest(async () => {
      const user = User.build({ id: 2, email: "grace@DB" });
      const entry = user.entries().build({ id: 1, message: "clashes" });
      const error = await user.save().catch((caught: unknown) => caught);
      return { error, isNew: entry.isNewRecord() };
    });

    expect(outcome.error).toBeInstanceOf(RecordNotUnique);
    expect(outcome.isNew).toBe(true);
    expect(await rows(db, "SELECT id FROM users WHERE id = 2")).toEqual([{ id: 2 }]);
  });
});

describe("a batch with records on another database", () => {
  test("refuses a save that autosaves them, before any callback runs", async () => {
    const saving = inRequest(async () => {
      const user = User.build({ id: 2, email: "grace@DB" });
      user.entries().build({ id: 2, message: "built" });
      return batch([user.toSave()]);
    });

    await expect(saving).rejects.toThrow(
      new IncompatibleRelation(
        "batch() needs its statements and records on one database, and saving this User " +
          "autosaves records through User.entries, on another database; save it outside the batch",
      ),
    );
    expect(log).toEqual([]);
  });

  test("db.batch refuses such a save, writing nothing", async () => {
    const saving = inRequest(async () => {
      const user = User.build({ id: 2, email: "grace@DB" });
      user.entries().build({ id: 2, message: "built" });
      return connect(db).batch([user.toSave()]);
    });

    await expect(saving).rejects.toThrow(IncompatibleRelation);
    expect(await rows(db, "SELECT id FROM users WHERE id = 2")).toEqual([]);
  });
});
