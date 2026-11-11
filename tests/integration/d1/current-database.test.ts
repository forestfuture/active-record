import { afterAll, beforeAll, describe, expect, test, vi } from "vite-plus/test";
import {
  batch,
  IncompatibleRelation,
  Model,
  NoDatabase,
  sql,
  withDatabase,
} from "../../../packages/active-record/src/index.ts";
import {
  d1,
  connect,
  type QueryEvent,
} from "../../../packages/active-record/src/adapters/d1/index.ts";
import { createTestDatabase, type TestDatabase } from "../../support/d1.ts";

// Level 1 reads the Worker's bindings from cloudflare:workers, which only exists inside a Worker;
// here it's this test's D1, set once the database exists.
const workers: { env: Record<string, unknown> } = { env: {} };
vi.mock("cloudflare:workers", () => workers);

/** An app's base class for the DB binding: its generated schema names the binding. */
abstract class DbRecord extends Model {
  static override schema = { adapter: d1({ binding: "DB" }), tables: {}, models: {} };
}

/** An app's base class for the LOGS binding: its generated schema names the binding. */
abstract class LogsRecord extends Model {
  static override schema = { adapter: d1({ binding: "LOGS" }), tables: {}, models: {} };
}

class User extends DbRecord.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  role: "string",
}) {
  static table = "users";
  static withRole = this.scope((q, role: string) => q.where({ role }));
}

// A Model naming no binding: only a request's database (or an explicit one) can serve it.
class Unbound extends Model.define({ id: { type: "integer", null: false }, email: "string" }) {
  static table = "users";
}

// A Model on a binding this Worker doesn't have.
class Elsewhere extends LogsRecord.define({ id: { type: "integer", null: false } }) {
  static table = "users";
}

let binding: TestDatabase;
let dispose: () => Promise<void>;

beforeAll(async () => {
  ({ db: binding, dispose } = await createTestDatabase());
  workers.env = { DB: binding };
  await connect(binding)
    .model(User)
    .insertAll([
      { id: 1, email: "ada@example.com", role: "admin" },
      { id: 2, email: "grace@example.com", role: "editor" },
    ]);
});
afterAll(() => dispose());

describe("Product.find(id): a query started from a Model", () => {
  test("level 1: with no setup, a Model queries its binding", async () => {
    expect((await User.find(1)).email).toBe("ada@example.com");
    expect((await User.withRole("editor").first())?.id).toBe(2);
  });

  test("level 2: inside withDatabase, the request's database is used, with its onQuery", async () => {
    const events: QueryEvent[] = [];
    const request = connect(binding, { onQuery: (event) => events.push(event) });

    const found = await withDatabase(request, () => User.all().order({ id: "desc" }).first());

    expect(found?.role).toBe("editor");
    expect(events.map((event) => event.sql)).toEqual([
      expect.stringMatching(/^SELECT \* FROM "users"/),
    ]);
  });

  test("level 2 outside a Worker: the request's database serves a Model with no binding", async () => {
    await expect(Unbound.find(1)).rejects.toThrow(
      new NoDatabase(
        "No database for this query: its Model's base class holds no generated schema, which names its adapter. Wrap the code in withDatabase(db, …), or use db.model(Model)",
      ),
    );
    expect((await withDatabase(connect(binding), () => Unbound.find(2))).email).toBe(
      "grace@example.com",
    );
  });

  test("records loaded through a level keep using it: save() writes to the same database", async () => {
    const events: QueryEvent[] = [];
    await withDatabase(connect(binding, { onQuery: (event) => events.push(event) }), async () => {
      const user = await User.find(1);
      await user.update({ role: "owner" });
    });

    expect(events.map((event) => event.sql.split(" ")[0])).toEqual(["SELECT", "UPDATE"]);
    expect((await User.find(1)).role).toBe("owner");
  });

  test("level 3: an explicit db is always its own", async () => {
    const events: QueryEvent[] = [];
    const db = connect(binding, { onQuery: (event) => events.push(event) });

    await withDatabase(connect(binding), () => db.model(User).find(1));

    expect(events).toHaveLength(1);
  });

  test("a binding the Worker doesn't have says to check the Wrangler config", async () => {
    await expect(Elsewhere.find(1)).rejects.toThrow(
      new NoDatabase(
        "The binding LOGS isn't in this Worker's env; check d1_databases in your Wrangler config",
      ),
    );
  });
});

describe("batch((b) => [...]): atomic writes on the current database", () => {
  test("statements and records from a Model's statics are written together, on its database", async () => {
    const events: QueryEvent[] = [];
    const user = User.build({ id: 3, email: "linus@example.com", role: "guest" });

    const [, saved] = await withDatabase(
      connect(binding, { onQuery: (event) => events.push(event) }),
      () => batch((b) => [b.updateAll(User.where({ id: 1 }), { role: "lead" }), b.save(user)]),
    );

    expect(saved.isPersisted()).toBe(true);
    expect((await User.find(1)).role).toBe("lead");
    expect(events).toHaveLength(2);
  });

  test("entries from two databases are refused, as db.batch refuses another's", async () => {
    const explicit = connect(binding);

    await expect(
      batch((b) => [b.updateAll(User, sql`role = role`), b.deleteAll(explicit.model(User))]),
    ).rejects.toThrow(IncompatibleRelation);
  });

  test("a batch of no writes sends nothing", async () => {
    expect(await batch(() => [])).toEqual([]);
  });

  test("a Model's statics and db.model(…) on the request's database are one database to a batch", async () => {
    const db = connect(binding);

    const results = await withDatabase(db, async () => {
      await batch((b) => [
        b.updateAll(User.where({ id: 2 }), sql`role = role`),
        b.updateAll(db.model(User).where({ id: 1 }), sql`role = role`),
      ]);
      return db.batch((b) => [b.updateAll(User.where({ id: 2 }), sql`role = role`)]);
    });

    expect(results).toHaveLength(1);
  });
});

describe("records keep the database they came from", () => {
  test("a record loaded inside withDatabase saves through that database after it returns", async () => {
    const events: QueryEvent[] = [];
    const request = connect(binding, { onQuery: (event) => events.push(event) });

    const user = await withDatabase(request, () => User.find(2));
    await user.update({ role: "editor-in-chief" });

    expect(events.map((event) => event.sql.split(" ")[0])).toEqual(["SELECT", "UPDATE"]);
  });

  test("a record built from a Model takes the database it's saved on, and keeps it", async () => {
    const events: QueryEvent[] = [];
    const user = User.build({ id: 4, email: "barbara@example.com" });

    await withDatabase(connect(binding, { onQuery: (event) => events.push(event) }), () =>
      user.save(),
    );
    await user.update({ role: "author" });

    expect(events.map((event) => event.sql.split(" ")[0])).toEqual(["INSERT", "UPDATE"]);
  });
});

describe("withDatabase, request by request", () => {
  test("concurrent requests each use their own database, however their awaits interleave", async () => {
    const seen = { a: [] as string[], b: [] as string[] };
    const run = (name: "a" | "b", delay: number) =>
      withDatabase(
        connect(binding, { onQuery: (event) => seen[name].push(event.sql) }),
        async () => {
          await User.find(1);
          // oxlint-disable-next-line d1-record/no-fixed-delay -- the delays interleave the two requests' awaits
          await new Promise((resolve) => setTimeout(resolve, delay));
          await User.count();
        },
      );

    await Promise.all([run("a", 15), run("b", 1)]);

    expect([seen.a.length, seen.b.length]).toEqual([2, 2]);
  });

  test("nested calls add to the outer databases, the inner one first", async () => {
    const outer: string[] = [];
    const inner: string[] = [];

    await withDatabase(connect(binding, { onQuery: (event) => outer.push(event.sql) }), () =>
      withDatabase(connect(binding, { onQuery: (event) => inner.push(event.sql) }), () =>
        User.count(),
      ),
    );

    expect([outer.length, inner.length]).toEqual([0, 1]);
  });

  test("given several, each Model uses the one on its binding; others keep their own", async () => {
    const onDb: string[] = [];
    const elsewhere = connect({} as never); // another binding's database, never matched

    await withDatabase(
      [elsewhere, connect(binding, { onQuery: (event) => onDb.push(event.sql) })],
      () => User.count(),
    );

    expect(onDb).toHaveLength(1);
  });
});
