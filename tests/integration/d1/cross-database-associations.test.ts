import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import {
  batch,
  belongsTo,
  DeleteRestriction,
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
import { createTestDatabase, recordingBatches, type TestDatabase } from "../../support/d1.ts";

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
  badges = hasMany(Badge, { foreignKey: "userId", primaryKey: "userId" });

  static {
    this.validates("message", { presence: true });
    this.beforeSave((entry) => void log.push(`before save ${entry.message}`));
    this.afterSave((entry) => void log.push(`after save ${entry.message}`));
    this.afterDestroy((entry) => void log.push(`after destroy ${entry.message}`));
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

/** Users whose records on LOGS go when they do, each by a strategy of its own. */
class Leaving extends DbRecord.define({ id: { type: "integer", null: false } }) {
  static override table = "users";

  entries = hasMany(Entry, { foreignKey: "userId", dependent: "destroy" });
}

class Purging extends DbRecord.define({ id: { type: "integer", null: false } }) {
  static override table = "users";

  entries = hasMany(Entry, { foreignKey: "userId", dependent: "deleteAll" });
  badge = hasOne(Badge, { foreignKey: "userId", dependent: "delete" });
}

class Detaching extends DbRecord.define({ id: { type: "integer", null: false } }) {
  static override table = "users";

  entries = hasMany(Entry, { foreignKey: "userId", dependent: "nullify" });
}

class Guarded extends DbRecord.define({ id: { type: "integer", null: false } }) {
  static override table = "users";

  entries = hasMany(Entry, { foreignKey: "userId", dependent: "restrictWithException" });
}

/** Users whose members, on DB, go when they do, and take the members' badges on LOGS with them. */
class Founder extends DbRecord.define({ id: { type: "integer", null: false } }) {
  static override table = "users";

  members = hasMany(Member, { foreignKey: "userId", dependent: "destroy" });

  static {
    this.beforeDestroy(() => void log.push("before destroy founder"));
  }
}

class Member extends DbRecord.define({
  id: { type: "integer", null: false },
  userId: "integer",
  message: { type: "string", null: false },
}) {
  static override table = "entries";

  badges = hasMany(Badge, { foreignKey: "userId", primaryKey: "userId", dependent: "deleteAll" });
}

/** Users who log an entry, on LOGS, each time they're saved. */
class Greeter extends DbRecord.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
}) {
  static override table = "users";

  entries = hasMany(Entry, { foreignKey: "userId" });

  static {
    this.beforeSave((greeter) => void greeter.entries().build({ message: "hello" }));
  }
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
  reads.length = 0;
});

/** Each read a database was sent, as its binding and the table it reads. */
const reads: string[] = [];

/** Logs each write a database is sent, by the database's binding, and keeps its reads. */
const writesTo =
  (binding: string) =>
  ({ sql }: QueryEvent): void => {
    if (sql.startsWith("SELECT")) reads.push(`${binding} ${/FROM "(\w+)"/.exec(sql)?.[1]}`);
    else log.push(`write ${binding}`);
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

  test("a required belongsTo looks for its record on its target's database", async () => {
    // User 2 is only on LOGS, the entry's own database: a decoy.
    await logs.prepare("INSERT INTO users (id, email) VALUES (2, 'decoy@LOGS')").run();

    const [found, missing] = await inRequest(async () => {
      const onDb = Entry.build({ id: 2, userId: 1, message: "found" });
      const onLogsOnly = Entry.build({ id: 3, userId: 2, message: "missing" });
      expect(await onLogsOnly.isValid()).toBe(false);
      return [await onDb.isValid(), onLogsOnly.errors.get("user")] as const;
    });

    expect(found).toBe(true);
    expect(missing).toEqual(["must exist"]);
    expect(reads).toEqual(["DB users", "DB users"]);
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

  test("push saves the records to the target's database", async () => {
    await inRequest(async () => {
      const user = await User.find(1);
      await user.entries().push(Entry.build({ id: 2, message: "pushed" }));
    });

    expect(await rows(logs, "SELECT user_id FROM entries WHERE id = 2")).toEqual([{ user_id: 1 }]);
    expect(await rows(db, "SELECT id FROM entries WHERE id = 2")).toEqual([]);
  });

  test("delete nullifies the records on the target's database", async () => {
    await inRequest(async () => {
      const user = await User.find(1);
      await user.entries().delete(await Entry.find(1));
    });

    expect(await rows(logs, "SELECT user_id FROM entries")).toEqual([{ user_id: null }]);
    expect(await rows(db, "SELECT user_id FROM entries")).toEqual([{ user_id: 1 }]);
  });

  test("destroy destroys the records on the target's database", async () => {
    await inRequest(async () => {
      const user = await User.find(1);
      await user.entries().destroy(await Entry.find(1));
    });

    expect(await rows(logs, "SELECT id FROM entries")).toEqual([]);
    expect(await rows(db, "SELECT id FROM entries")).toEqual([{ id: 1 }]);
  });

  test("clear removes the records on the target's database", async () => {
    await inRequest(async () => (await Purging.find(1)).entries().clear());

    expect(await rows(logs, "SELECT id FROM entries")).toEqual([]);
    expect(await rows(db, "SELECT id FROM entries")).toEqual([{ id: 1 }]);
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

  test("records built through a built record come back to the owner's database", async () => {
    await inRequest(async () => {
      const user = User.build({ id: 2, email: "grace@DB" });
      const entry = user.entries().build({ id: 2, message: "built" });
      entry.notes().build({ id: 2, body: "noted" });
      await user.saveOrThrow();
    });

    expect(await rows(logs, "SELECT user_id FROM entries WHERE id = 2")).toEqual([{ user_id: 2 }]);
    expect(await rows(db, "SELECT entry_id, body FROM notes WHERE id = 2")).toEqual([
      { entry_id: 2, body: "noted" },
    ]);
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
  test("refuses a save whose callback builds them, writing nothing", async () => {
    const saving = inRequest(() =>
      batch((b) => [b.save(Greeter.build({ id: 2, email: "grace@DB" }))]),
    );

    await expect(saving).rejects.toThrow(
      new IncompatibleRelation(
        "batch() needs its statements and records on one database, and saving this Greeter " +
          "writes records on another database; save it outside the batch",
      ),
    );
    expect(await rows(db, "SELECT id FROM users WHERE id = 2")).toEqual([]);
    expect(await rows(logs, "SELECT id FROM entries WHERE id <> 1")).toEqual([]);
  });

  test("refuses a save that autosaves them, before any callback runs", async () => {
    const saving = inRequest(async () => {
      const user = User.build({ id: 2, email: "grace@DB" });
      user.entries().build({ id: 2, message: "built" });
      return batch((b) => [b.save(user)]);
    });

    await expect(saving).rejects.toThrow(
      new IncompatibleRelation(
        "batch() needs its statements and records on one database, and saving this User " +
          "autosaves records through User.entries, on another database; save it outside the batch",
      ),
    );
    expect(log).toEqual([]);
  });

  test("db.batch refuses a save that autosaves them, writing nothing", async () => {
    const saving = inRequest(async () => {
      const user = User.build({ id: 2, email: "grace@DB" });
      user.entries().build({ id: 2, message: "built" });
      return connect(db).batch((b) => [b.save(user)]);
    });

    await expect(saving).rejects.toThrow(IncompatibleRelation);
    expect(await rows(db, "SELECT id FROM users WHERE id = 2")).toEqual([]);
  });
});

describe("destroying an owner whose dependents are on another database", () => {
  test("destroy destroys them there", async () => {
    await inRequest(async () => (await Leaving.find(1)).destroyOrThrow());

    expect(await rows(logs, "SELECT id FROM entries")).toEqual([]);
    expect(await rows(db, "SELECT message FROM entries")).toEqual([{ message: "DB" }]);
  });

  test("destroy writes there before the owner's database, then runs their callbacks", async () => {
    await inRequest(async () => (await Leaving.find(1)).destroyOrThrow());

    expect(log).toEqual(["write LOGS", "write DB", "after destroy LOGS"]);
  });

  test("deleteAll deletes them there", async () => {
    await inRequest(async () => (await Purging.find(1)).destroyOrThrow());

    expect(await rows(logs, "SELECT id FROM entries")).toEqual([]);
    expect(await rows(db, "SELECT message FROM entries")).toEqual([{ message: "DB" }]);
  });

  test("a hasOne's delete deletes its record there", async () => {
    await inRequest(async () => (await Purging.find(1)).destroyOrThrow());

    expect(await rows(logs, "SELECT id FROM badges")).toEqual([]);
    expect(await rows(db, "SELECT label FROM badges")).toEqual([{ label: "DB" }]);
  });

  test("nullify clears their foreign key there", async () => {
    await inRequest(async () => (await Detaching.find(1)).destroyOrThrow());

    expect(await rows(logs, "SELECT user_id FROM entries")).toEqual([{ user_id: null }]);
    expect(await rows(db, "SELECT user_id FROM entries")).toEqual([{ user_id: 1 }]);
  });

  test("a restriction looks for them there", async () => {
    await logs.prepare("DELETE FROM entries").run();

    await inRequest(async () => (await Guarded.find(1)).destroyOrThrow());

    expect(await rows(db, "SELECT id FROM users")).toEqual([]);
  });

  test("a restriction refuses while they exist there", async () => {
    await db.prepare("DELETE FROM entries").run();

    const destroying = inRequest(async () => (await Guarded.find(1)).destroyOrThrow());

    await expect(destroying).rejects.toThrow(DeleteRestriction);
  });

  test("a batch refuses a destroy whose dependents' dependents are there, before any callback runs", async () => {
    const destroying = inRequest(async () => {
      const record = await Founder.find(1);
      return batch((b) => [b.destroy(record)]);
    });

    await expect(destroying).rejects.toThrow(
      new IncompatibleRelation(
        "batch() needs its statements and records on one database, and destroying this " +
          "Founder writes its dependent Member.badges, on another database; destroy it " +
          "outside the batch",
      ),
    );
    expect(log).toEqual([]);
  });

  test("a batch refuses the destroy before any callback runs", async () => {
    const destroying = inRequest(async () => {
      const record = await Leaving.find(1);
      return batch((b) => [b.destroy(record)]);
    });

    await expect(destroying).rejects.toThrow(
      new IncompatibleRelation(
        "batch() needs its statements and records on one database, and destroying this " +
          "Leaving writes its dependent Leaving.entries, on another database; destroy it " +
          "outside the batch",
      ),
    );
    expect(await rows(db, "SELECT id FROM users")).toEqual([{ id: 1 }]);
  });
});

describe("preloading an association to another database", () => {
  test("a belongsTo's records come from the target's database", async () => {
    const [entry] = await inRequest(() => Entry.includes("user").toArray());

    expect(entry!.loaded("user")?.email).toBe("ada@DB");
  });

  test("a hasMany's records come from the target's database", async () => {
    const user = await inRequest(() => User.includes("entries").find(1));

    expect(user.loaded("entries").map((entry) => entry.message)).toEqual(["LOGS"]);
  });

  test("its query goes to the target's database, after the records' own", async () => {
    await inRequest(() => User.includes("entries").find(1));

    expect(reads).toEqual(["DB users", "LOGS entries"]);
  });

  test("the levels under it go with it, in one round trip there", async () => {
    const recorded = { DB: recordingBatches(db), LOGS: recordingBatches(logs) };
    // Assigned onto the env the library has read, as an app's test mocks do.
    Object.assign(workers.env, { DB: recorded.DB.binding, LOGS: recorded.LOGS.binding });
    try {
      const databases = [connect(recorded.DB.binding), connect(recorded.LOGS.binding)];
      const user = await withDatabase(databases, () =>
        User.includes({ entries: "badges" }).find(1),
      );
      expect(
        user
          .loaded("entries")[0]!
          .loaded("badges")
          .map((badge) => badge.label),
      ).toEqual(["LOGS"]);
    } finally {
      Object.assign(workers.env, { DB: db, LOGS: logs });
    }

    expect(recorded.LOGS.batches).toEqual([2]);
  });

  test("a level under it that crosses back comes from the first database", async () => {
    const user = await inRequest(() => User.includes({ entries: "notes" }).find(1));

    expect(
      user
        .loaded("entries")[0]!
        .loaded("notes")
        .map((note) => note.body),
    ).toEqual(["DB"]);
  });

  test("an owner from an explicit database preloads from the target's binding", async () => {
    const user = await connect(db).model(User).includes("entries").find(1);

    expect(user.loaded("entries").map((entry) => entry.message)).toEqual(["LOGS"]);
  });

  test("the records it preloads save to the target's database", async () => {
    await inRequest(async () => {
      const user = await User.includes("entries").find(1);
      await user.loaded("entries")[0]!.update({ message: "changed" });
    });

    expect(await rows(logs, "SELECT message FROM entries")).toEqual([{ message: "changed" }]);
  });
});
