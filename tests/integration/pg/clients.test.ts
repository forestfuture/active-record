import { afterAll, afterEach, beforeAll, describe, expect, test } from "vite-plus/test";
import {
  Model,
  RecordNotUnique,
  hasMany,
  sql,
  withDatabase,
} from "../../../packages/active-record/src/index.ts";
import {
  connect,
  type Database,
} from "../../../packages/active-record/src/adapters/postgresql/index.ts";
import { openPgSchema, type PgSchema } from "../../support/pg.ts";

// Each row is the backend (connection) its query ran on.
class BackendSession extends Model.define({
  id: { type: "integer", null: false },
  backendId: "integer",
}) {
  static table = "backend_sessions";
}

class Backend extends Model.define({ id: { type: "integer", null: false } }) {
  static table = "backends";
  sessions = hasMany(BackendSession, { foreignKey: "backendId" });
}

class User extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  role: "string",
}) {
  static table = "users";
}

/** A promise, and what settles it. */
function deferred() {
  let resolve = () => {};
  const promise = new Promise<void>((settle) => (resolve = settle));
  return { promise, resolve };
}

describe("the PostgreSQL adapter's clients, from a connection string (#269)", () => {
  let schema: PgSchema;
  let db: Database;
  // Node gives each deprecation once per process, so this hears the file's from its first test.
  const warnings: Error[] = [];
  const heard = (warning: Error) => warnings.push(warning);

  const backend = async () => (await db.model(Backend).pluck("id"))[0];
  const closed = () => expect.poll(() => schema.connections()).toBe(0);
  /** Settles once a slow query (`pg_sleep`) the test sent is running: on backend `on`, if given. */
  const sleeping = (on?: number) =>
    expect
      .poll(async () =>
        (await schema.running()).some(
          ({ backend, query }) =>
            query.includes("pg_sleep") && (on === undefined || backend === on),
        ),
      )
      .toBe(true);

  beforeAll(async () => {
    process.on("warning", heard);
    schema = await openPgSchema();
  });
  afterAll(async () => {
    process.off("warning", heard);
    await schema.dispose();
  });
  afterEach(async () => {
    await schema.pool.query({ text: "DELETE FROM users" });
    await closed();
  });

  beforeAll(() => {
    db = connect(schema.url);
  });

  test("outside a scope, each operation gets a client of its own, closed when it's done", async () => {
    const first = await backend();
    const second = await backend();

    expect(first).not.toBe(second);
    await closed();
  });

  test("in a scope, the first query opens a client that serves the scope, closed when it ends", async () => {
    const seen = await withDatabase(db, async () => {
      const before = await schema.connections();
      const first = await backend();
      const second = await backend();
      return { before, first, second, during: await schema.connections() };
    });

    expect(seen).toMatchObject({ before: 0, during: 1 });
    expect(seen.first).toBe(seen.second);
    await closed();
  });

  test("nested scopes keep the client until the outermost ends", async () => {
    const seen = await withDatabase(db, async () => {
      const inner = await withDatabase(db, backend);
      return { inner, after: await backend(), open: await schema.connections() };
    });

    expect(seen.after).toBe(seen.inner);
    expect(seen.open).toBe(1);
    await closed();
  });

  test("overlapping scopes of one Database each get a client of their own", async () => {
    const gate = deferred();
    const first = withDatabase(db, async () => {
      const before = await backend();
      await gate.promise;
      return [before, await backend()];
    });

    const second = await withDatabase(db, async () => [await backend(), await backend()]);
    gate.resolve();
    const [firstBefore, firstAfter] = await first;

    expect(firstAfter).toBe(firstBefore);
    expect(second[1]).toBe(second[0]);
    expect(second[0]).not.toBe(firstBefore);
    await closed();
  });

  test("a scope whose client loses its connection opens a new one for its next query", async () => {
    const seen = await withDatabase(db, async () => {
      const first = await backend();
      await schema.pool.query({ text: "SELECT pg_terminate_backend($1)", values: [first] });
      // Sent before or after pg hears the connection go: it fails, or opens the new client.
      await backend().catch(() => undefined);
      return { first, next: await backend() };
    });

    expect(seen.next).not.toBe(seen.first);
    await closed();
  });

  test("a query pg refuses before sending leaves the scope's client serving the others", async () => {
    const circular: Record<string, unknown> = {};
    circular["self"] = circular;

    const outcomes = await withDatabase(db, () =>
      Promise.allSettled([
        db
          .model(Backend)
          .where(sql`(SELECT true FROM pg_sleep(0.2))`)
          .pluck("id"),
        db
          .model(Backend)
          .where(sql`id = ${circular}`)
          .pluck("id"),
        backend(),
      ]),
    );

    expect(outcomes.map(({ status }) => status)).toEqual(["fulfilled", "rejected", "fulfilled"]);
    await closed();
  });

  test("a scope whose backend is ended mid-query opens a new client for its next query", async () => {
    const seen = await withDatabase(db, async () => {
      const first = await backend();
      const slow = db
        .model(Backend)
        .where(sql`(SELECT true FROM pg_sleep(1))`)
        .pluck("id")
        .catch((error: unknown) => error);
      await sleeping(first);
      await schema.pool.query({ text: "SELECT pg_terminate_backend($1)", values: [first] });
      return { first, failed: await slow, next: await backend() };
    });

    expect(seen.failed).toMatchObject({ code: "57P01" });
    expect(seen.next).not.toBe(seen.first);
    await closed();
  });

  /** A slow query on the scope's backend `id`, with a read queued behind it, and that backend ended. */
  const queuedBehindEnded = (id: number | undefined) => {
    const slow = db
      .model(Backend)
      .where(sql`(SELECT true FROM pg_sleep(1))`)
      .pluck("id")
      .catch((error: unknown) => error);
    const queued = backend();
    // Ended once the slow query is running on it, so it fails as the backend goes.
    const ending = sleeping(id).then(() =>
      schema.pool.query({ text: "SELECT pg_terminate_backend($1)", values: [id] }),
    );
    return { slow, queued, ending };
  };

  test("an operation queued behind a query whose backend is ended runs on a new client", async () => {
    const seen = await withDatabase(db, async () => {
      const first = await backend();
      const { slow, queued, ending } = queuedBehindEnded(first);
      await ending;
      return { first, failed: await slow, queued: await queued };
    });

    expect(seen.failed).toMatchObject({ code: "57P01" });
    expect(seen.queued).toEqual(expect.any(Number));
    expect(seen.queued).not.toBe(seen.first);
    await closed();
  });

  test("a client opened by an operation queued when its scope ended is closed once it's done", async () => {
    let queued: ReturnType<typeof queuedBehindEnded> | undefined;
    await withDatabase(db, async () => {
      queued = queuedBehindEnded(await backend());
    });
    await Promise.all([queued!.ending, queued!.slow, queued!.queued]);

    await closed();
  });

  test("an operation still queued when its scope ends runs on the scope's client", async () => {
    let slow: Promise<number[]> | undefined;
    let queued: Promise<number | undefined> | undefined;
    const scoped = await withDatabase(db, async () => {
      const id = await backend();
      slow = db
        .model(Backend)
        .where(sql`(SELECT true FROM pg_sleep(0.2))`)
        .pluck("id");
      queued = backend();
      return id;
    });

    expect(await queued).toBe(scoped);
    await slow;
    await closed();
  });

  test("a call nested after its outer call returned has a client of its own, closed when it ends", async () => {
    const returned = deferred();
    let later: Promise<(number | undefined)[]> | undefined;

    const outer = await withDatabase(db, async () => {
      // Started inside the outer call, run once it has returned.
      later = returned.promise.then(() =>
        withDatabase(db, async () => [await backend(), await backend()]),
      );
      return backend();
    });
    returned.resolve();
    const [first, second] = await later!;

    expect(second).toBe(first);
    expect(first).not.toBe(outer);
    await closed();
  });

  test("a read batch runs on one client: a preload sees the backend of its owners' query", async () => {
    const [found] = await db.model(Backend).includes("sessions").toArray();

    expect(found!.loaded("sessions").map((session) => session.id)).toEqual([found!.id]);
  });

  test("a save started in a scope that finishes after it still saves, on a client of its own", async () => {
    const gate = deferred();
    class LateUser extends User {
      static {
        this.beforeSave(async () => {
          await gate.promise;
        });
      }
    }
    let saving: Promise<boolean> | undefined;

    await withDatabase(db, async () => {
      await backend();
      saving = db.model(LateUser).build({ email: "late@example.com" }).save();
    });
    await closed();
    gate.resolve();

    expect(await saving).toBe(true);
    expect(await db.model(User).pluck("email")).toEqual(["late@example.com"]);
    await closed();
  });

  /** A scope that ends while a slow query it started is running on its client: the query, and the scope's id. */
  const endingMidQuery = async () => {
    let running: Promise<number[]> | undefined;
    let hasSettled = false;
    const scoped = await withDatabase(db, async () => {
      const id = await backend();
      running = db
        .model(Backend)
        .where(sql`(SELECT true FROM pg_sleep(0.2))`)
        .pluck("id")
        .finally(() => (hasSettled = true));
      // Running on Postgres, on the scope's client, before the scope ends.
      await sleeping(id);
      return id;
    });
    return { running: running!, scoped, hasSettledAtEnd: hasSettled };
  };

  test("a query still running when its scope ends finishes on the scope's client before it closes", async () => {
    const { running, scoped } = await endingMidQuery();

    expect(await running).toEqual([scoped]);
    await closed();
  });

  test("a scope ends without waiting for a query still running on its client", async () => {
    const { running, hasSettledAtEnd } = await endingMidQuery();

    expect(hasSettledAtEnd).toBe(false);
    await running;
    await closed();
  });

  test("a write beside a failing batch is kept: the batch has a client of its own (ADR-0017)", async () => {
    const users = db.model(User);

    const outcome = await withDatabase(db, async () => {
      const batch = db
        .batch([
          users.toInsert({ email: "in-batch@example.com" }),
          users.where(sql`(SELECT true FROM pg_sleep(0.2))`).toUpdateAll({ role: "slow" }),
          users.toInsert({ email: "in-batch@example.com" }),
        ])
        .catch((error: unknown) => error);
      await sleeping();
      await users.create({ email: "beside@example.com" });
      return batch;
    });

    expect(outcome).toBeInstanceOf(RecordNotUnique);
    expect(await users.pluck("email")).toEqual(["beside@example.com"]);
  });

  // Last, so it hears a query sent beside another anywhere in the file (#288).
  test("operations sent at once in a scope take turns on its one client", async () => {
    const seen = await withDatabase(db, async () => {
      const [preloaded, ...ids] = await Promise.all([
        db.model(Backend).includes("sessions").toArray(),
        backend(),
        backend(),
      ]);
      const [found] = preloaded;
      const sessions = found!.loaded("sessions").map((session) => session.id);
      return { backends: [found!.id, ...sessions, ...ids], open: await schema.connections() };
    });

    expect(new Set(seen.backends).size).toBe(1);
    expect(seen.open).toBe(1);
    expect(warnings.map(({ message }) => message)).not.toContainEqual(
      expect.stringContaining("already executing a query"),
    );
    await closed();
  });
});
