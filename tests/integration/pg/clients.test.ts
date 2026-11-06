import { afterAll, afterEach, beforeAll, describe, expect, test } from "vite-plus/test";
import {
  Model,
  RecordNotUnique,
  hasMany,
  sql,
  withDatabase,
} from "../../../packages/active-record/src/index.ts";
import { connect, type Database } from "../../../packages/pg-record/src/index.ts";
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

describe("pg-record's clients, from a connection string (#269)", () => {
  let schema: PgSchema;
  let db: Database;

  const backend = async () => (await db.model(Backend).pluck("id"))[0];
  const closed = () => expect.poll(() => schema.connections()).toBe(0);

  beforeAll(async () => {
    schema = await openPgSchema();
  });
  afterAll(() => schema.dispose());
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
      // Long enough for it to reach Postgres, on the scope's client, before the scope ends.
      await new Promise((resolve) => setTimeout(resolve, 50));
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
      await new Promise((resolve) => setTimeout(resolve, 50));
      await users.create({ email: "beside@example.com" });
      return batch;
    });

    expect(outcome).toBeInstanceOf(RecordNotUnique);
    expect(await users.pluck("email")).toEqual(["beside@example.com"]);
  });
});
