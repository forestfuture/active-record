// Normalizations (#354) against a real database: conditions are normalized as assigned values are,
// and an association's link to its owner isn't.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  between,
  column,
  gte,
  hasMany,
  Model,
  sql,
} from "../../packages/active-record/src/index.ts";
import { openHarness, type Harness } from "../support/harness.ts";

class Member extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  role: "string",
}) {
  static table = "users";

  static {
    this.normalizes("email", { with: (email) => email.trim().toLowerCase() });
  }
}

// A role that's never null once assigned: "member" in its place.
class Teammate extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  role: "string",
}) {
  static table = "users";

  static {
    this.normalizes("role", { with: (role) => role ?? "member", applyToNull: true });
  }
}

// A key normalized to its absolute value, so -2 finds 2.
class Account extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
}) {
  static table = "users";

  static {
    this.normalizes("id", { with: (id) => Math.abs(id) });
  }
}

// A foreign key normalized so user 2's key becomes user 1's: a normalizer that maps two keys to one.
class Entry extends Model.define({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
}) {
  static table = "posts";

  static {
    this.normalizes("userId", { with: (userId) => (userId === 2 ? 1 : userId) });
  }
}

class Author extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
}) {
  static table = "users";

  entries = hasMany(Entry, { foreignKey: "userId" });
}

describe("a normalized attribute's conditions", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());

  const db = () => harness.connect();
  const emails = (members: readonly { email: string }[]) =>
    members.map(({ email }) => email).toSorted();

  beforeEach(async () => {
    await harness.reset("posts", "users");
    await harness.exec("INSERT INTO users (id, email, role) VALUES (?, ?, ?)", [
      1,
      "a@example.com",
      "admin",
    ]);
    await harness.exec("INSERT INTO users (id, email, role) VALUES (?, ?, ?)", [
      2,
      "b@example.com",
      null,
    ]);
  });

  test("where matches a value as it's normalized", async () => {
    const found = await db().model(Member).where({ email: " A@Example.COM " }).toArray();
    expect(emails(found)).toEqual(["a@example.com"]);
  });

  test("findBy matches a value as it's normalized", async () => {
    const found = await db().model(Member).findBy({ email: "B@EXAMPLE.com" });
    expect(found?.id).toBe(2);
  });

  test("exists matches a value as it's normalized", async () => {
    expect(await db().model(Member).exists({ email: " a@example.com" })).toBe(true);
  });

  test("whereNot leaves out a value as it's normalized", async () => {
    const found = await db().model(Member).whereNot({ email: "A@example.com" }).toArray();
    expect(emails(found)).toEqual(["b@example.com"]);
  });

  test("a list matches each of its values as it's normalized", async () => {
    const found = await db()
      .model(Member)
      .where({ email: [" A@Example.com", "B@Example.com "] })
      .toArray();
    expect(emails(found)).toEqual(["a@example.com", "b@example.com"]);
  });

  test("a comparison compares with its values as they're normalized", async () => {
    // Unnormalized, " B…" sorts before every lowercase address, so both rows would match.
    const found = await db()
      .model(Member)
      .where({ email: gte(" B@EXAMPLE.COM") })
      .toArray();
    expect(emails(found)).toEqual(["b@example.com"]);
  });

  test("between compares with both ends as they're normalized", async () => {
    const found = await db()
      .model(Member)
      .where({ email: between("A@EXAMPLE.COM", "A@EXAMPLE.COM") })
      .toArray();
    expect(emails(found)).toEqual(["a@example.com"]);
  });

  test("rewhere matches a value as it's normalized", async () => {
    const found = await db()
      .model(Member)
      .where({ email: "a@example.com" })
      .rewhere({ email: " B@Example.com" })
      .toArray();
    expect(emails(found)).toEqual(["b@example.com"]);
  });

  test("inOrderOf orders and keeps values as they're normalized", async () => {
    const found = await db()
      .model(Member)
      .inOrderOf("email", [" B@Example.com", "A@Example.com "])
      .toArray();
    expect(found.map(({ email }) => email)).toEqual(["b@example.com", "a@example.com"]);
  });

  test("a typed value in an sql fragment matches as it's normalized", async () => {
    const found = await db()
      .model(Member)
      .where(sql`${column("email")} = ${column("email").value(" A@Example.COM")}`)
      .toArray();
    expect(emails(found)).toEqual(["a@example.com"]);
  });

  test("findOrCreateBy finds the record a value matches as it's normalized", async () => {
    const found = await db().model(Member).findOrCreateBy({ email: " B@Example.com " });
    expect(found.id).toBe(2);
    expect(await db().model(Member).count()).toBe(2);
  });

  test("find looks up a key as it's normalized", async () => {
    const found = await db().model(Account).find(-2);
    expect(found.email).toBe("b@example.com");
  });

  test("find looks up several keys as they're normalized", async () => {
    const found = await db().model(Account).find([-2, 1]);
    expect(found.map(({ id }) => id)).toEqual([2, 1]);
  });

  test("null matches NULL, even when the normalization applies to null", async () => {
    const found = await db().model(Teammate).where({ role: null }).toArray();
    expect(found.map(({ id }) => id)).toEqual([2]);
  });

  test("an association's link to its owner is kept as the owner's key", async () => {
    await harness.exec("INSERT INTO posts (id, user_id, title) VALUES (?, ?, ?)", [1, 1, "One"]);
    await harness.exec("INSERT INTO posts (id, user_id, title) VALUES (?, ?, ?)", [2, 2, "Two"]);
    const author = await db().model(Author).find(2);

    const entries = await author.entries().toArray();

    expect(entries.map(({ title }) => title)).toEqual(["Two"]);
  });
});

describe("a normalized attribute's written values", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());

  const members = () => harness.connect().model(Member);
  const storedEmails = async () =>
    (await harness.exec("SELECT email FROM users ORDER BY id")).map(({ email }) => email);

  beforeEach(async () => {
    await harness.reset("posts", "users");
  });

  test("create stores the value normalized", async () => {
    await members().create({ id: 1, email: " Jane@Example.com " });
    expect(await storedEmails()).toEqual(["jane@example.com"]);
  });

  test("insert stores the value normalized", async () => {
    await members().insert({ id: 1, email: " Jane@Example.com " });
    expect(await storedEmails()).toEqual(["jane@example.com"]);
  });

  test("insertAll stores each row's value normalized", async () => {
    await members().insertAll([
      { id: 1, email: " Jane@Example.com" },
      { id: 2, email: "Sam@Example.com " },
    ]);
    expect(await storedEmails()).toEqual(["jane@example.com", "sam@example.com"]);
  });

  test("upsert stores the value normalized", async () => {
    await members().insert({ id: 1, email: "jane@example.com" });
    await members().upsert({ id: 1, email: " Sam@Example.com " });
    expect(await storedEmails()).toEqual(["sam@example.com"]);
  });

  test("an insert stores a createWith value normalized", async () => {
    await members()
      .createWith({ email: " Jane@Example.com " })
      .insert({ id: 1 } as never);
    expect(await storedEmails()).toEqual(["jane@example.com"]);
  });

  test("updateAll stores the value normalized", async () => {
    await members().insert({ id: 1, email: "jane@example.com" });
    await members().updateAll({ email: " Sam@Example.com " });
    expect(await storedEmails()).toEqual(["sam@example.com"]);
  });

  test("updateColumns stores the value normalized", async () => {
    const member = await members().create({ id: 1, email: "jane@example.com" });
    await member.updateColumns({ email: " Sam@Example.com " });
    expect(await storedEmails()).toEqual(["sam@example.com"]);
  });
});
