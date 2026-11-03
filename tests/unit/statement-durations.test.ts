import { describe, expect, test } from "vite-plus/test";
import { d1Adapter } from "../../src/d1/adapter.ts";
import type { Driver, StatementResult } from "../../src/driver.ts";
import { DatabaseExecutor, type QueryEvent } from "../../src/executor.ts";
import type { CompiledSql } from "../../src/compiler.ts";
import type { ModelClass } from "../../src/model.ts";

const model = { name: "Thing", onQuery: undefined } as unknown as ModelClass;
const statement = (sql: string): CompiledSql => ({ sql, params: [], model });

/** A driver whose statements return no rows, with the durations given (none when undefined). */
function driverTiming(durations: readonly (number | undefined)[]): Driver {
  const results = (): StatementResult[] =>
    durations.map((durationMs) => ({ rows: [], rowsAffected: 0, durationMs }));
  return {
    send: async () => results()[0]!,
    read: async () => results(),
    write: async () => results(),
    recover: () => false,
  };
}

describe("a statement's reported duration", () => {
  test("is the database's own timing for each statement sent together, when it reports one", async () => {
    const events: QueryEvent[] = [];
    const executor = new DatabaseExecutor(d1Adapter, driverTiming([3, 5]), (event) =>
      events.push(event),
    );

    await executor.read([statement("SELECT 1"), statement("SELECT 2")]);

    expect(events.map((event) => event.durationMs)).toEqual([3, 5]);
  });

  test("is the time they took together, when the database reports none", async () => {
    const events: QueryEvent[] = [];
    const executor = new DatabaseExecutor(
      d1Adapter,
      driverTiming([undefined, undefined]),
      (event) => events.push(event),
    );

    await executor.write([statement("UPDATE a"), statement("UPDATE b")]);

    expect(events).toHaveLength(2);
    for (const event of events) expect(event.durationMs).toBeGreaterThanOrEqual(0);
    expect(events[0]?.durationMs).toBe(events[1]?.durationMs);
  });
});
