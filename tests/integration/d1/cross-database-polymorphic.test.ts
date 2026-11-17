import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import {
  belongsTo,
  hasMany,
  Model,
  withDatabase,
} from "../../../packages/active-record/src/index.ts";
import { connect, d1 } from "../../../packages/active-record/src/adapters/d1/index.ts";
import { createTestDatabase, recordingBatches, type TestDatabase } from "../../support/d1.ts";

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

  remarks = hasMany(Remark, { as: "subject" });
}

class Entry extends LogsRecord.define({
  id: { type: "integer", null: false },
  message: { type: "string", null: false },
}) {
  static override table = "entries";

  remarks = hasMany(Remark, { as: "subject" });
}

/** A remark, on DB, about a user on DB or an entry on LOGS (#60). */
class Remark extends DbRecord.define({
  id: { type: "integer", null: false },
  subjectType: "string",
  subjectId: "integer",
  body: { type: "string", null: false },
}) {
  static override table = "remarks";

  subject = belongsTo([User, Entry]);
}

class Note extends DbRecord.define({
  id: { type: "integer", null: false },
  body: { type: "string", null: false },
}) {
  static override table = "notes";
}

/** A remark, on DB, about a user or a note, both on DB too. */
class LocalRemark extends DbRecord.define({
  id: { type: "integer", null: false },
  subjectType: "string",
  subjectId: "integer",
  body: { type: "string", null: false },
}) {
  static override table = "remarks";

  subject = belongsTo([User, Note]);
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
      ...["users", "entries", "remarks"].map((table) => binding.prepare(`DELETE FROM ${table}`)),
      binding.prepare("INSERT INTO users (id, email) VALUES (1, ?)").bind(`ada@${where}`),
      binding.prepare("INSERT INTO entries (id, message) VALUES (1, ?)").bind(where),
      binding
        .prepare(
          "INSERT INTO remarks (id, subject_type, subject_id, body) VALUES (1, 'User', 1, ?), (2, 'Entry', 1, ?)",
        )
        .bind(`on a user in ${where}`, `on an entry in ${where}`),
    ]);
  }
});

describe("a polymorphic belongsTo whose Models are on different databases (#60)", () => {
  test("reads each record from its Model's database", async () => {
    const [onUser, onEntry] = await withDatabase(connect(db), () =>
      Remark.order({ id: "asc" }).toArray(),
    );

    expect(((await onUser!.subject()) as User).email).toBe("ada@DB");
    expect(((await onEntry!.subject()) as Entry).message).toBe("LOGS");
  });

  test("an as: association reads its records from their own database", async () => {
    const entry = await withDatabase(connect(logs), () => Entry.find(1));

    const remarks = await entry.remarks().toArray();

    expect(remarks.map(({ body }) => body)).toEqual(["on an entry in DB"]);
  });

  test("a new record set through it is saved on its Model's database first", async () => {
    const remark = await withDatabase([connect(db), connect(logs)], async () => {
      const built = Remark.build({ id: 3, body: "on a new entry" });
      built.subject.set(Entry.build({ id: 2, message: "new" }));
      await built.saveOrThrow();
      return built;
    });

    const onLogs = await logs.prepare("SELECT message FROM entries WHERE id = 2").all();
    const onDb = await db.prepare("SELECT message FROM entries WHERE id = 2").all();
    expect(onLogs.results).toEqual([{ message: "new" }]);
    expect(onDb.results).toEqual([]);
    const row = await db.prepare("SELECT subject_type, subject_id FROM remarks WHERE id = 3").all();
    expect(row.results).toEqual([{ subject_type: "Entry", subject_id: 2 }]);
    expect(remark.isPersisted()).toBe(true);
  });

  test("preloads each Model's records from its database: one round trip on each", async () => {
    const recorded = { DB: recordingBatches(db), LOGS: recordingBatches(logs) };
    // Assigned onto the env the library has read, as an app's test mocks do.
    Object.assign(workers.env, { DB: recorded.DB.binding, LOGS: recorded.LOGS.binding });
    try {
      const databases = [connect(recorded.DB.binding), connect(recorded.LOGS.binding)];
      const [onUser, onEntry] = await withDatabase(databases, () =>
        Remark.includes("subject").order({ id: "asc" }).toArray(),
      );

      expect((onUser!.loaded("subject") as User).email).toBe("ada@DB");
      expect((onEntry!.loaded("subject") as Entry).message).toBe("LOGS");
    } finally {
      Object.assign(workers.env, { DB: db, LOGS: logs });
    }

    expect(recorded.DB.batches).toEqual([2]);
    // The entries' one statement, sent on its own: no batch.
    expect(recorded.LOGS.batches).toEqual([]);
  });

  test("preloads every listed Model on one database with the query, in one round trip", async () => {
    await db.batch([
      db.prepare("DELETE FROM remarks WHERE id = 2"),
      db.prepare("INSERT INTO notes (id, entry_id, body) VALUES (2, NULL, 'a note')"),
      db.prepare(
        "INSERT INTO remarks (id, subject_type, subject_id, body) VALUES (3, 'Note', 2, 'x')",
      ),
    ]);
    const recorded = recordingBatches(db);
    // Assigned onto the env the library has read, as an app's test mocks do.
    Object.assign(workers.env, { DB: recorded.binding });
    const remarks = await withDatabase(connect(recorded.binding), () =>
      LocalRemark.includes("subject").order({ id: "asc" }).toArray(),
    ).finally(() => Object.assign(workers.env, { DB: db }));

    expect(remarks.map((remark) => remark.loaded("subject")?.constructor)).toEqual([User, Note]);
    expect(recorded.batches).toEqual([3]);
  });
});
