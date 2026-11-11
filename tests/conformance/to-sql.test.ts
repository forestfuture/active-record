import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { Model } from "../../packages/active-record/src/index.ts";
import { User } from "../fixtures/models/user.ts";
import type { QueryEvent } from "../../packages/active-record/src/executor.ts";
import { openHarness, type Harness } from "../support/harness.ts";

// A secret as the primary key: sessions looked up by their token (filtered by default).
class Session extends Model.define({
  token: { type: "string", null: false, column: "id" },
  label: { type: "string", null: false },
}) {
  static table = "api_keys";
  static primaryKey = "token";
}

describe("toSql", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());

  const events: QueryEvent[] = [];
  const db = () => harness.connect({ onQuery: (event) => events.push(event) });
  const sent = () => events.map((event) => ({ sql: event.sql, params: event.params }));
  beforeEach(async () => {
    events.length = 0;
    await harness.reset("posts", "users");
    await harness.exec("INSERT INTO users (id, email) VALUES (1, 'a@example.com')");
    await harness.exec("INSERT INTO users (id, email) VALUES (2, 'b@example.com')");
  });

  describe("a Relation", () => {
    test("is the SELECT toArray sends, with its values bound, and sends nothing itself", async () => {
      const admins = db().model(User).where({ role: "admin" }).order({ email: "asc" }).limit(5);

      const { sql, params } = admins.toSql();

      expect(events).toEqual([]);
      expect(params).toEqual(["admin", 5]);
      expect(sql).not.toContain("admin");
      await admins.toArray();
      expect(sent()).toEqual([{ sql, params }]);
    });

    // A guard: toSql shares the compiler with toArray, so this passes as soon as it exists.
    test("shows the columns a partial record really loads, including the keys includes needs", async () => {
      const users = db().model(User).select("email").includes("posts");

      const { sql, params } = users.toSql();

      expect(sql).toContain('"id"');
      await users.toArray();
      expect(sent()[0]).toEqual({ sql, params });
    });
  });

  test("a none() Relation shows its 1 = 0 form, with no database", () => {
    const { sql, params } = User.none().toSql();

    expect(sql).toContain("1 = 0");
    expect(params).toEqual([]);
  });

  // A guard, as Rails: its to_sql shows real values while its logs filter them (#83).
  test("shows a filtered attribute's real value, which onQuery still hides", async () => {
    const users = db().model(User).where({ email: "a@example.com" });

    expect(users.toSql().params).toEqual(["a@example.com"]);
    await users.toArray();
    expect(events[0]?.params).toEqual(["[FILTERED]"]);
  });

  test("is a static on a Model, with no database", () => {
    const { sql, params } = User.where({ role: "admin" }).toSql();

    expect(sql).toContain("WHERE");
    expect(params).toEqual(["admin"]);
  });

  test("returns a copy, so changing its params leaves the next toSql alone", () => {
    const users = User.where({ role: "admin" });

    users.toSql().params.push("tampered");

    expect(users.toSql().params).toEqual(["admin"]);
  });

  test("shows a filtered primary key's real value", () => {
    expect(db().model(Session).where({ token: "s3cret" }).toSql().params).toEqual(["s3cret"]);
  });

  test("keeps includes and select when none() is chained, and shows an owner's hasMany", async () => {
    const none = User.select("email").includes("posts").none().toSql();
    expect(none.sql).toContain('"id"');
    expect(none.sql).toContain("1 = 0");

    const user = await db().model(User).find(1);
    const posts = user.posts().toSql();
    expect(posts.params).toEqual([1]);
    expect(posts.sql).toContain('FROM "posts"');
  });
});
