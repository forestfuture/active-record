import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import {
  batch,
  Model,
  NotNullViolation,
  withDatabase,
} from "../../packages/active-record/src/index.ts";
import type { QueryEvent } from "../../packages/active-record/src/executor.ts";
import { openHarness, type Harness } from "../support/harness.ts";

// An app's base class with an app-wide listener (#78), as application-record.ts would declare it.
const logged: QueryEvent[] = [];
abstract class ApplicationRecord extends Model {
  static override onQuery = (event: QueryEvent) => {
    logged.push(event);
  };
}

class User extends ApplicationRecord.define({
  id: { type: "integer", null: false },
  email: "string",
}) {
  static table = "users";
}
class Post extends ApplicationRecord.define({
  id: { type: "integer", null: false },
  userId: "integer",
  title: "string",
}) {
  static table = "posts";
}

// A Model that replaces the inherited listener with its own.
const quiet: QueryEvent[] = [];
class Quiet extends User {
  static override onQuery = (event: QueryEvent) => {
    quiet.push(event);
  };
}

let harness: Harness;
beforeAll(async () => {
  harness = await openHarness();
});
afterAll(() => harness.dispose());
beforeEach(() => {
  logged.length = 0;
  quiet.length = 0;
});

describe("an app-wide onQuery on the base class", () => {
  test("runs after a database's own listener, which sees the Model too", async () => {
    const order: string[] = [];
    class Ordered extends User {
      static override onQuery = ({ model }: QueryEvent) => {
        order.push(`class: ${model}`);
      };
    }
    const db = harness.connect({ onQuery: ({ model }) => order.push(`database: ${model}`) });

    await withDatabase(db, () => Ordered.count());

    expect(order).toEqual(["database: Ordered", "class: Ordered"]);
  });

  test("a Model's own replaces the inherited one, as any static does", async () => {
    await harness.connect().model(Quiet).count();

    expect([logged.length, quiet.length]).toEqual([0, 1]);
  });

  test("in a batch, each statement reports its own Model", async () => {
    await withDatabase(harness.connect(), () =>
      batch([User.where({ id: 0 }).toDeleteAll(), Post.where({ id: 0 }).toDeleteAll()]),
    );

    expect(logged.map(({ model }) => model)).toEqual(["User", "Post"]);
  });

  test("a failed statement is reported with its error", async () => {
    await expect(harness.connect().model(User).insert({ id: 1, email: null })).rejects.toThrow();

    expect(logged.at(-1)).toMatchObject({ model: "User", error: expect.any(Error) });
  });
});

describe("a listener that throws", () => {
  // Never changes a query's outcome: it's logged, and the other listener still runs.
  const failing = () => {
    throw new Error("listener bug");
  };
  class Fragile extends User {
    static override onQuery = failing;
  }

  test("on success: the query's result stands, and the error is logged", async () => {
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      expect(await harness.connect({ onQuery: failing }).model(Fragile).count()).toBe(0);
      expect(errors.mock.calls.map(([message]) => message)).toEqual([
        "onQuery threw; the query's result is unaffected:",
        "onQuery threw; the query's result is unaffected:",
      ]);
    } finally {
      errors.mockRestore();
    }
  });

  test("on a database error: the caller gets it, translated, and the other listener still runs", async () => {
    const seen: QueryEvent[] = [];
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    class Watched extends User {
      static override onQuery = (event: QueryEvent) => {
        seen.push(event);
      };
    }
    try {
      await expect(
        harness.connect({ onQuery: failing }).model(Watched).insert({ id: 1, email: null }),
      ).rejects.toThrow(NotNullViolation);
      expect(seen).toHaveLength(1);
    } finally {
      errors.mockRestore();
    }
  });

  test("in a failed batch: every statement is still reported, and the database's error reaches the caller", async () => {
    const seen: QueryEvent[] = [];
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});
    try {
      const db = harness.connect({ onQuery: failing });
      class Watched extends User {
        static override onQuery = (event: QueryEvent) => {
          seen.push(event);
        };
      }
      await expect(
        db.batch([
          db.model(Watched).where({ id: 0 }).toDeleteAll(),
          db.model(Watched).toInsert({ id: 2, email: null }),
        ]),
      ).rejects.toThrow(NotNullViolation);
      expect(seen.map(({ error }) => error !== undefined)).toEqual([true, true]);
    } finally {
      errors.mockRestore();
    }
  });
});
