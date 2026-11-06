import { describe, expect, test } from "vite-plus/test";
import { d1Adapter } from "../../packages/d1-record/src/adapter.ts";
import { withDatabase } from "../../packages/active-record/src/index.ts";
import { AnyDatabase, databaseExecutor } from "../../packages/active-record/src/database.ts";
import type { Driver } from "../../packages/active-record/src/driver.ts";
import { DatabaseExecutor } from "../../packages/active-record/src/executor.ts";
import type { CompiledSql } from "../../packages/active-record/src/compiler.ts";
import type { ModelClass } from "../../packages/active-record/src/model.ts";

const model = { name: "Thing", onQuery: undefined } as unknown as ModelClass;
const statement: CompiledSql = { sql: "SELECT 1", params: [], model };

/** A driver that numbers the scopes it opens, and records each one's end and each statement's. */
function scopedDriver(failsToOpen = false) {
  const seen = { opened: 0, closed: [] as unknown[], sentIn: [] as unknown[] };
  const driver: Driver<number> = {
    send: async (_, scope) => {
      seen.sentIn.push(scope);
      return { rows: [], rowsAffected: 0 };
    },
    read: async () => [],
    write: async () => [],
    recover: () => false,
    openScope: () => {
      if (failsToOpen) throw new Error("no scope");
      return ++seen.opened;
    },
    closeScope: async (scope) => {
      seen.closed.push(scope);
    },
  };
  return { db: new AnyDatabase(new DatabaseExecutor(d1Adapter, driver)), seen };
}

const send = (db: AnyDatabase) => db[databaseExecutor].run(statement);

describe("a driver's withDatabase scopes", () => {
  test("each call opens one, handed to its statements; a nested call with the same database shares it", async () => {
    const { db, seen } = scopedDriver();

    await withDatabase(db, async () => {
      await send(db);
      await withDatabase(db, () => send(db));
    });
    await withDatabase(db, () => send(db));

    expect(seen).toEqual({ opened: 2, closed: [1, 2], sentIn: [1, 1, 2] });
  });

  test("a call nested in one that has already returned opens its own, as a waitUntil's does", async () => {
    const { db, seen } = scopedDriver();
    let later: Promise<unknown> | undefined;

    await withDatabase(db, async () => {
      await send(db);
      later = new Promise((resolve) => setTimeout(resolve, 10)).then(() =>
        withDatabase(db, () => send(db)),
      );
    });
    await later;

    expect(seen).toEqual({ opened: 2, closed: [1, 2], sentIn: [1, 2] });
  });

  test("a scope already opened is closed when another database's fails to open", async () => {
    const opens = scopedDriver();
    const fails = scopedDriver(true);

    await expect(withDatabase([opens.db, fails.db], () => "ran")).rejects.toThrow("no scope");

    expect(opens.seen.closed).toEqual([1]);
  });
});
