import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { User } from "../fixtures/models/user.ts";
import { openHarness, type Harness } from "../support/harness.ts";

const ids = (users: User[]) => users.map((user) => user.id);

describe("ordering and pagination", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await openHarness();
    await harness.exec(`INSERT INTO users (id, email, role, created_at) VALUES
           (1, 'a@example.com', 'member', '2026-03-01T00:00:00.000Z'),
           (2, 'b@example.com', 'admin',  '2026-01-01T00:00:00.000Z'),
           (3, 'c@example.com', 'member', '2026-02-01T00:00:00.000Z'),
           (4, 'd@example.com', 'admin',  '2026-04-01T00:00:00.000Z')`);
  });
  afterAll(() => harness.dispose());

  test("order sorts by each key in turn, and repeated calls append", async () => {
    const users = harness.connect().model(User);

    const newestFirst = await users.order({ createdAt: "desc" }).toArray();
    const byRoleThenId = await users.order({ role: "asc", id: "desc" }).toArray();
    const appended = await users.order({ role: "asc" }).order({ createdAt: "asc" }).toArray();

    expect(ids(newestFirst)).toEqual([4, 1, 3, 2]);
    expect(ids(byRoleThenId)).toEqual([4, 2, 3, 1]);
    expect(ids(appended)).toEqual([2, 4, 3, 1]);
  });

  test("limit and offset page through ordered records, and offset works without a limit", async () => {
    const byId = harness.connect().model(User).order({ id: "asc" });

    expect(ids(await byId.limit(2).toArray())).toEqual([1, 2]);
    expect(ids(await byId.limit(2).offset(2).toArray())).toEqual([3, 4]);
    expect(ids(await byId.offset(3).toArray())).toEqual([4]);
  });

  test("first and last use primary-key order when the relation has none", async () => {
    const users = harness.connect().model(User);

    expect((await users.first())?.id).toBe(1);
    expect((await users.last())?.id).toBe(4);
  });

  test("last reverses every direction of an explicit order", async () => {
    const users = harness.connect().model(User).order({ role: "asc", createdAt: "desc" });

    // Ordered: 4 (admin, Apr), 2 (admin, Jan), 1 (member, Mar), 3 (member, Feb)
    expect((await users.first())?.id).toBe(4);
    expect((await users.last())?.id).toBe(3);
  });

  test("take returns one record without adding an order, or null", async () => {
    const users = harness.connect().model(User);

    const admin = await users.where({ role: "admin" }).take();
    const nobody = await users.where({ role: "owner" }).take();

    expect([2, 4]).toContain(admin?.id);
    expect(nobody).toBeNull();
    expect(await users.where({ role: "owner" }).first()).toBeNull();
    expect(await users.where({ role: "owner" }).last()).toBeNull();
  });

  test("first and last work within the page that limit and offset select", async () => {
    const byId = harness.connect().model(User).order({ id: "asc" });

    expect((await byId.limit(2).first())?.id).toBe(1);
    expect((await byId.limit(2).last())?.id).toBe(2);
    expect((await byId.offset(2).first())?.id).toBe(3);
    expect((await byId.offset(2).last())?.id).toBe(4);
    expect((await byId.limit(2).offset(1).last())?.id).toBe(3);
  });

  test("an empty page (limit 0) has no first, last, take or match", async () => {
    const empty = harness.connect().model(User).order({ id: "asc" }).limit(0);

    expect(await empty.toArray()).toEqual([]);
    expect(await empty.first()).toBeNull();
    expect(await empty.last()).toBeNull();
    expect(await empty.take()).toBeNull();
    expect(await empty.exists()).toBe(false);
  });
});
