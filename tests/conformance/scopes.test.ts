import { afterAll, afterEach, beforeAll, describe, expect, test, vi } from "vite-plus/test";
import { Model, sql } from "../../packages/active-record/src/index.ts";
import type { QueryEvent } from "../../packages/active-record/src/executor.ts";
import { openHarness, type Harness } from "../support/harness.ts";

class User extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  role: "string",
  isActive: "boolean",
  createdAt: "datetime",
}) {
  static table = "users";

  static active = this.scope((q) => q.where({ isActive: true }));
  static recent = this.scope((q) => q.order({ createdAt: "desc" }));
  static createdAfter = this.scope((q, since: Date) => q.where(sql`created_at > ${since}`));
  static createdWithinDays = this.scope((q, days: number) =>
    q.where(sql`created_at > ${new Date(Date.now() - days * 86_400_000)}`),
  );
}

describe("scopes", () => {
  let harness: Harness;
  const ids = (users: User[]) => users.map((user) => user.id);

  beforeAll(async () => {
    harness = await openHarness();
    await harness.exec(`INSERT INTO users (id, email, role, is_active, created_at) VALUES
           (1, 'a@example.com', 'admin',  TRUE, '2026-01-01T00:00:00.000Z'),
           (2, 'b@example.com', 'member', TRUE, '2026-03-01T00:00:00.000Z'),
           (3, 'c@example.com', 'admin',  FALSE, '2026-04-01T00:00:00.000Z'),
           (4, 'd@example.com', 'admin',  TRUE, '2026-05-01T00:00:00.000Z')`);
  });
  afterAll(() => harness.dispose());
  afterEach(() => {
    vi.useRealTimers();
  });

  test("scopes are callable on the model and after any chained call, and compose", async () => {
    const users = harness.connect().model(User);

    const activeRecent = await users.active().recent().toArray();
    const adminsAfter = await users
      .where({ role: "admin" })
      .active()
      .createdAfter(new Date(Date.UTC(2026, 1, 1)))
      .toArray();

    expect(ids(activeRecent)).toEqual([4, 2, 1]);
    expect(ids(adminsAfter)).toEqual([4]);
  });

  test("calling scopes never queries; only a terminal operation does", async () => {
    const queries: QueryEvent[] = [];
    const users = harness.connect({ onQuery: (event) => queries.push(event) }).model(User);

    const relation = users.active().recent().where({ role: "admin" }).active();
    expect(queries).toHaveLength(0);

    await relation.toArray();
    expect(queries).toHaveLength(1);
  });

  test("a scope computes its values when it's called, not when the class was defined", async () => {
    const queries: QueryEvent[] = [];
    const users = harness.connect({ onQuery: (event) => queries.push(event) }).model(User);
    vi.useFakeTimers();

    vi.setSystemTime(new Date(Date.UTC(2026, 3, 2)));
    const aprilWeek = await users.createdWithinDays(7).toArray();
    vi.setSystemTime(new Date(Date.UTC(2026, 4, 2)));
    const mayWeek = await users.createdWithinDays(7).toArray();

    expect(queries.map((query) => query.params[0])).toEqual([
      "2026-03-26T00:00:00.000Z",
      "2026-04-25T00:00:00.000Z",
    ]);
    expect(ids(aprilWeek)).toEqual([3, 4]);
    expect(ids(mayWeek)).toEqual([4]);
  });
});
