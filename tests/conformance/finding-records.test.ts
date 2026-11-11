import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { ActiveRecordError, RecordNotFound } from "../../packages/active-record/src/index.ts";
import { User } from "../fixtures/models/user.ts";
import { openHarness, type Harness } from "../support/harness.ts";

describe("finding records", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.exec("DELETE FROM users");
    await harness.exec(`INSERT INTO users (id, email, role) VALUES
           (1, 'a@example.com', 'admin'),
           (2, 'b@example.com', 'member'),
           (3, 'c@example.com', 'member')`);
  });

  test("find returns the record with that primary key", async () => {
    const user = await harness.connect().model(User).find(2);

    expect(user).toBeInstanceOf(User);
    expect(user.email).toBe("b@example.com");
  });

  test("find throws RecordNotFound when no row has that primary key", async () => {
    const lookup = harness.connect().model(User).find(99);

    await expect(lookup).rejects.toThrow(RecordNotFound);
    await expect(lookup).rejects.toThrow(ActiveRecordError);
    await expect(lookup).rejects.toThrow(/User.*99/);
  });

  test("find keeps the relation's conditions, so an excluded row isn't found", async () => {
    const admins = harness.connect().model(User).where({ role: "admin" });

    await expect(admins.find(1)).resolves.toBeInstanceOf(User);
    await expect(admins.find(2)).rejects.toThrow(RecordNotFound);
  });

  test("findBy returns the matching record, or null when there isn't one", async () => {
    const users = harness.connect().model(User);

    const found = await users.findBy({ email: "a@example.com" });
    const missing = await users.findBy({ email: "nobody@example.com" });

    expect(found?.id).toBe(1);
    expect(missing).toBeNull();
  });

  test("findByOrThrow returns the matching record, or throws RecordNotFound", async () => {
    const users = harness.connect().model(User);

    await expect(users.findByOrThrow({ role: "member" })).resolves.toMatchObject({ id: 2 });
    await expect(users.findByOrThrow({ role: "owner" })).rejects.toThrow(RecordNotFound);
  });

  test("finders ignore the relation's order, limit and offset", async () => {
    const paged = harness.connect().model(User).order({ id: "asc" }).limit(1).offset(10);

    await expect(paged.find(2)).resolves.toMatchObject({ id: 2 });
    await expect(paged.findBy({ role: "member" })).resolves.toMatchObject({ id: 2 });
  });

  describe("find with several ids", () => {
    test("find(a, b) and find([a, b]) return the records in the ids' order", async () => {
      const users = harness.connect().model(User);

      expect((await users.find(3, 1)).map((user) => user.id)).toEqual([3, 1]);
      expect((await users.find([2, 3, 1])).map((user) => user.id)).toEqual([2, 3, 1]);
    });

    test("with an order on the Relation, the records come in that order instead", async () => {
      const users = harness.connect().model(User).order({ email: "desc" });

      expect((await users.find(1, 3)).map((user) => user.id)).toEqual([3, 1]);
    });

    test("a missing id throws RecordNotFound naming what was found", async () => {
      const lookup = harness.connect().model(User).find(1, 99);

      await expect(lookup).rejects.toThrow(RecordNotFound);
      await expect(lookup).rejects.toThrow(
        "Couldn't find all User records with 'id': (1, 99) (found 1 results, but was looking for 2)",
      );
    });

    test("the Relation's conditions apply, so an excluded id is missing", async () => {
      const members = harness.connect().model(User).where({ role: "member" });

      await expect(members.find([1, 2])).rejects.toThrow(RecordNotFound);
      expect((await members.find([2, 3])).map((user) => user.id)).toEqual([2, 3]);
    });

    test("repeated ids are found once, an array of one gives an array, and [] gives []", async () => {
      const users = harness.connect().model(User);

      expect((await users.find(2, 2, 1)).map((user) => user.id)).toEqual([2, 1]);
      expect((await users.find([2])).map((user) => user.id)).toEqual([2]);
      expect(await users.find([])).toEqual([]);
    });

    test('ids are cast to the key\'s type first, as Rails does, so "01" and 1 are the same id', async () => {
      const users = harness.connect().model(User);

      expect((await users.find("03", 2)).map((user) => user.id)).toEqual([3, 2]);
      expect((await users.find("1", "01", 1)).map((user) => user.id)).toEqual([1]);
    });

    test("on none() nothing is found without a query, and [] gives []", async () => {
      let queries = 0;
      const users = harness
        .connect({ onQuery: () => queries++ })
        .model(User)
        .none();

      await expect(users.find(1, 2)).rejects.toThrow(RecordNotFound);
      expect(await users.find([])).toEqual([]);
      expect(queries).toBe(0);
    });

    test("it's one query", async () => {
      let queries = 0;
      const users = harness.connect({ onQuery: () => queries++ }).model(User);

      await users.find(1, 2, 3);

      expect(queries).toBe(1);
    });
  });
});
