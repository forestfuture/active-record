import { afterAll, beforeAll, describe, expect, test, vi } from "vite-plus/test";
import { Model } from "../../packages/active-record/src/index.ts";
import type { QueryEvent } from "../../packages/active-record/src/executor.ts";
import { openHarness, type Harness } from "../support/harness.ts";

class User extends Model.define({ id: "integer", email: "string" }) {
  static table = "users";
  // These tests read bound values, so nothing is filtered (#83).
  static override filterAttributes = [];
}

class Missing extends Model.define({ id: "integer" }) {
  static table = "no_such_table";
}

describe("instrumentation", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());

  test("a successful statement reports its sql, params, duration and the database's meta", async () => {
    const queries: QueryEvent[] = [];
    const db = harness.connect({ onQuery: (event) => queries.push(event) });

    await db.model(User).where({ email: "a@example.com" }).toArray();

    expect(queries).toHaveLength(1);
    expect(queries[0]?.params).toEqual(["a@example.com"]);
    expect(queries[0]?.durationMs).toBeGreaterThanOrEqual(0);
    expect(queries[0]?.meta).toBeDefined();
    expect(queries[0]?.error).toBeUndefined();
  });

  test("a failing statement reports one event with the error, then rethrows it", async () => {
    const queries: QueryEvent[] = [];
    const db = harness.connect({ onQuery: (event) => queries.push(event) });

    const failure = db.model(Missing).toArray();

    const error: unknown = await failure.catch((caught: unknown) => caught);
    expect(error).toBeInstanceOf(Error);
    expect(queries).toHaveLength(1);
    expect(queries[0]?.error).toBe(error);
  });

  test("a listener that throws is called once, logged, and never changes the query's result (#78)", async () => {
    const events: QueryEvent[] = [];
    const listenerError = new Error("listener failed");
    const db = harness.connect({
      onQuery: (event) => {
        events.push(event);
        throw listenerError;
      },
    });
    const errors = vi.spyOn(console, "error").mockImplementation(() => {});

    try {
      expect(await db.model(User).toArray()).toEqual(expect.any(Array));
      expect(errors.mock.calls).toEqual([
        ["onQuery threw; the query's result is unaffected:", listenerError],
      ]);
    } finally {
      errors.mockRestore();
    }
    expect(events).toHaveLength(1);
    expect(events[0]?.error).toBeUndefined();
  });
});
