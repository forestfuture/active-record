import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { Model, sql } from "../../packages/active-record/src/index.ts";
import type { QueryEvent } from "../../packages/active-record/src/executor.ts";
import { openHarness, type Harness } from "../support/harness.ts";

class User extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  role: "string",
  suspended: { type: "boolean", null: false },
}) {
  static table = "users";
}

describe("conditions", () => {
  let harness: Harness;
  const ids = async (relation: { toArray(): Promise<User[]> }) =>
    (await relation.toArray()).map((user) => user.id).sort((a, b) => a - b);

  beforeAll(async () => {
    harness = await openHarness();
    await harness.exec(`INSERT INTO users (id, email, role, suspended) VALUES
           (1, 'a@example.com', 'admin',  0),
           (2, 'b@example.com', 'member', 1),
           (3, 'c@example.com', NULL,     0),
           (4, 'd@example.com', 'admin',  1)`);
  });
  afterAll(() => harness.dispose());

  test("an array value matches any of its values", async () => {
    const users = harness.connect().model(User);

    expect(await ids(users.where({ id: [1, 3, 99] }))).toEqual([1, 3]);
    expect(await ids(users.where({ role: ["admin", "member"] }))).toEqual([1, 2, 4]);
  });

  test("an empty array matches nothing", async () => {
    const users = harness.connect().model(User);

    expect(await ids(users.where({ id: [] }))).toEqual([]);
  });

  test("an array containing null also matches NULL", async () => {
    const users = harness.connect().model(User);

    expect(await ids(users.where({ role: ["member", null] }))).toEqual([2, 3]);
  });

  test("whereNot follows SQL semantics, so a NULL value is excluded too", async () => {
    const users = harness.connect().model(User);

    expect(await ids(users.whereNot({ role: "admin" }))).toEqual([2]);
  });

  test("whereNot negates the whole condition, not each attribute", async () => {
    const users = harness.connect().model(User);

    // NOT (role = 'admin' AND suspended = 1): only user 4 is a suspended admin.
    expect(await ids(users.whereNot({ role: "admin", suspended: true }))).toEqual([1, 2, 3]);
  });

  test("whereNot handles null, empty arrays, arrays with null, and sql fragments", async () => {
    const users = harness.connect().model(User);

    expect(await ids(users.whereNot({ role: null }))).toEqual([1, 2, 4]);
    expect(await ids(users.whereNot({ id: [] }))).toEqual([1, 2, 3, 4]);
    expect(await ids(users.whereNot({ role: ["member", null] }))).toEqual([1, 4]);
    expect(await ids(users.whereNot(sql`id < ${3}`))).toEqual([3, 4]);
  });

  test("where and whereNot combine with AND", async () => {
    const users = harness.connect().model(User);

    expect(await ids(users.where({ role: "admin" }).whereNot({ suspended: true }))).toEqual([1]);
  });

  test("count counts matching rows, and count(attr) counts non-null values", async () => {
    const users = harness.connect().model(User);

    expect(await users.count()).toBe(4);
    expect(await users.where({ role: "admin" }).count()).toBe(2);
    expect(await users.count("role")).toBe(3);
    expect(await users.order({ id: "asc" }).limit(2).count()).toBe(2);
  });

  test("exists is true when any row matches, optionally with extra conditions", async () => {
    const users = harness.connect().model(User);

    expect(await users.where({ role: "admin" }).exists()).toBe(true);
    expect(await users.exists({ role: "owner" })).toBe(false);
    expect(await users.where({ suspended: true }).exists({ role: "member" })).toBe(true);
  });

  test("pluck returns converted attribute values, or tuples for several attributes", async () => {
    const users = harness.connect().model(User).order({ id: "asc" });

    expect(await users.pluck("suspended")).toEqual([false, true, false, true]);
    expect(await users.where({ role: "admin" }).pluck("id", "email")).toEqual([
      [1, "a@example.com"],
      [4, "d@example.com"],
    ]);
  });

  test("distinct removes duplicate rows, and count counts distinct values", async () => {
    const users = harness.connect().model(User);

    const roles = await users.order({ role: "asc" }).distinct().pluck("role");

    expect(roles).toEqual([null, "admin", "member"]);
    expect(await users.select("role").distinct().count()).toBe(3);
    expect(await users.distinct().count("role")).toBe(2);
  });

  test("an empty conditions object adds no condition, as when built from optional filters", async () => {
    const users = harness.connect().model(User);

    expect(await ids(users.where({}))).toEqual([1, 2, 3, 4]);
    expect(await ids(users.whereNot({}))).toEqual([1, 2, 3, 4]);
    expect((await users.findBy({}))?.id).toBeTypeOf("number");
    expect(await users.exists({})).toBe(true);
  });

  test("an undefined value is rejected instead of silently matching nothing", async () => {
    const users = harness.connect().model(User);
    const body: { email?: string } = {};

    expect(() => users.where({ role: undefined })).toThrow(TypeError);
    expect(() => users.whereNot({ role: ["admin", undefined as never] })).toThrow(/"role".*null/);
    await expect(users.findBy({ email: body.email })).rejects.toThrow(TypeError);
  });

  test("pluck needs at least one attribute", async () => {
    const users = harness.connect().model(User);

    // @ts-expect-error pluck() needs an attribute
    await expect(users.pluck()).rejects.toThrow(TypeError);
  });

  test("a list of any length is one bound value, so no limit on bound parameters applies", async () => {
    const events: QueryEvent[] = [];
    const users = harness.connect({ onQuery: (event) => events.push(event) }).model(User);
    const many = Array.from({ length: 250 }, (_, index) => index + 1);

    expect(await ids(users.where({ id: many }))).toEqual([1, 2, 3, 4]);
    expect(await ids(users.whereNot({ id: many }))).toEqual([]);
    expect(await ids(users.where({ role: ["member", null], suspended: [true] }))).toEqual([2]);
    expect(events.map((event) => event.params.length)).toEqual([1, 1, 2]);
    expect((await users.find(many.slice(0, 4))).map((user) => user.id)).toEqual([1, 2, 3, 4]);
  });
});
