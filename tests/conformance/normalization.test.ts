// Normalizations (#354) against a real database: conditions are normalized as assigned values are,
// and an association's link to its owner isn't.
import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  belongsTo,
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

// A virtual attribute whose default is normalized, as any value assigned to it.
class Invitee extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  greeting: { type: "string", virtual: true, default: () => "  Welcome " },
}) {
  static table = "users";

  static {
    this.normalizes("greeting", { with: (greeting) => greeting.trim() });
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

  test("a record created through an association keeps its owner's key", async () => {
    const author = await db().model(Author).find(2);

    const entry = await author.entries().create({ id: 3, title: "Three" });

    const [row] = await harness.exec("SELECT user_id FROM posts WHERE id = 3");
    expect([entry.userId, Number(row?.user_id)]).toEqual([2, 2]);
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

describe("a record loaded with a value stored before its normalization", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());

  const db = () => harness.connect();

  beforeEach(async () => {
    await harness.reset("posts", "users");
    await harness.exec("INSERT INTO users (id, email) VALUES (?, ?)", [1, " Jane@Example.com"]);
  });

  test("keeps the value as it's stored, unchanged", async () => {
    const member = await db().model(Member).find(1);
    expect(member.email).toBe(" Jane@Example.com");
    expect(member.isChanged()).toBe(false);
  });

  test("isn't found by the value it's stored with", async () => {
    expect(await db().model(Member).findBy({ email: " Jane@Example.com" })).toBeNull();
  });

  test("normalizeAttribute normalizes the value, and save stores it", async () => {
    const member = await db().model(Member).find(1);

    member.normalizeAttribute("email");

    expect(member.changes()).toEqual({ email: [" Jane@Example.com", "jane@example.com"] });
    await member.saveOrThrow();
    const [row] = await harness.exec("SELECT email FROM users WHERE id = 1");
    expect(row?.email).toBe("jane@example.com");
  });

  test("starts a virtual attribute at its default, normalized", async () => {
    const invitee = await db().model(Invitee).find(1);
    expect(invitee.greeting).toBe("Welcome");
  });
});

// Normalizers that map key 2 to key 1, so a lookup by a key copied from a record would find
// another record's row if the key were normalized.
const twoToOne = (key: number) => (key === 2 ? 1 : key);

class Writer extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
}) {
  static table = "users";

  static {
    this.normalizes("id", { with: twoToOne });
  }
}

class Note extends Model.define({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
}) {
  static table = "posts";

  writer = belongsTo(Writer, { foreignKey: "userId" });

  static {
    this.normalizes("id", { with: twoToOne });
  }
}

class Owner extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
}) {
  static table = "users";

  notes = hasMany(Note, { foreignKey: "userId", dependent: "deleteAll" });
  assignments = hasMany(Assignment, { foreignKey: "userId" });
  projects = hasMany(Project, { through: "assignments" });
}

class Project extends Model.define({
  id: { type: "integer", null: false },
  name: { type: "string", null: false },
}) {
  static table = "projects";
}

class Assignment extends Model.define({
  id: { type: "integer", null: false },
  userId: "integer",
  projectId: "integer",
}) {
  static table = "assignments";

  project = belongsTo(Project);

  static {
    this.normalizes("projectId", { with: twoToOne });
  }
}

describe("a lookup by a key copied from a record", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());

  const db = () => harness.connect();

  beforeEach(async () => {
    await harness.reset("assignments", "projects", "posts", "users");
    await harness.exec("INSERT INTO users (id, email) VALUES (?, ?)", [1, "a@example.com"]);
    await harness.exec("INSERT INTO users (id, email) VALUES (?, ?)", [2, "b@example.com"]);
    await harness.exec("INSERT INTO posts (id, user_id, title) VALUES (?, ?, ?)", [1, 1, "One"]);
    await harness.exec("INSERT INTO posts (id, user_id, title) VALUES (?, ?, ?)", [2, 2, "Two"]);
  });

  test("a belongsTo reads the record its key names", async () => {
    const note = await db().model(Note).findByOrThrow({ title: "Two" });

    const writer = await note.writer();

    expect(writer?.email).toBe("b@example.com");
  });

  test("a preload finds each owner's records by its own key", async () => {
    const notes = await db().model(Note).includes("writer").order({ title: "asc" }).toArray();

    const emails = notes.map((note) => note.loaded("writer")?.email);

    expect(emails).toEqual(["a@example.com", "b@example.com"]);
  });

  test("deleting a record through a hasMany deletes its own row", async () => {
    const owner = await db().model(Owner).find(2);
    const [note] = await owner.notes().toArray();

    await owner.notes().delete(note!);

    const rows = await harness.exec("SELECT title FROM posts ORDER BY id");
    expect(rows.map(({ title }) => title)).toEqual(["One"]);
  });

  test("removing a record through a through association removes its own join row", async () => {
    await harness.exec("INSERT INTO projects (id, name) VALUES (?, ?)", [1, "Garden"]);
    await harness.exec("INSERT INTO projects (id, name) VALUES (?, ?)", [2, "Kitchen"]);
    await harness.exec(
      "INSERT INTO assignments (id, user_id, project_id) VALUES (?, ?, ?)",
      [10, 1, 1],
    );
    await harness.exec(
      "INSERT INTO assignments (id, user_id, project_id) VALUES (?, ?, ?)",
      [20, 1, 2],
    );
    const owner = await db().model(Owner).find(1);
    const kitchen = await db().model(Project).find(2);

    await owner.projects().delete(kitchen);

    const rows = await harness.exec("SELECT id FROM assignments ORDER BY id");
    expect(rows.map(({ id }) => Number(id))).toEqual([10]);
  });
});
