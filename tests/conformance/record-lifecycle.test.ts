import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  MissingAttribute,
  Model,
  NoDatabase,
  sql,
  RecordDestroyed,
  RecordNotFound,
  UnknownAttribute,
} from "../../packages/active-record/src/index.ts";
import type { QueryEvent } from "../../packages/active-record/src/executor.ts";
import { openHarness, type Harness } from "../support/harness.ts";

class User extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  role: "string",
  isActive: "boolean",
}) {
  static table = "users";
}

let counter = 0;

class ApiKey extends Model.define({
  id: { type: "string", null: false, default: () => `key-${++counter}` },
  label: { type: "string", null: false },
  scopes: "json",
  expiresAt: "datetime",
}) {
  static table = "api_keys";
}

describe("record lifecycle", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.reset("users", "api_keys");
  });

  test("build makes a new, unsaved record without querying, and evaluates defaults", () => {
    const queries: QueryEvent[] = [];
    const db = harness.connect({ onQuery: (event) => queries.push(event) });

    const user = db.model(User).build({ email: "a@example.com" });
    const key = db.model(ApiKey).build({ label: "deploy" });

    expect(user).toBeInstanceOf(User);
    expect(user.isNewRecord()).toBe(true);
    expect(user.isPersisted()).toBe(false);
    expect(user.email).toBe("a@example.com");
    expect(user.role).toBeNull();
    expect(key.id).toMatch(/^key-\d+$/);
    expect(queries).toHaveLength(0);
  });

  test("saving a new record inserts it; the database fills in its key and column defaults", async () => {
    const users = harness.connect().model(User);
    const user = users.build({ email: "a@example.com" });

    expect(await user.save()).toBe(true);

    expect(user.isPersisted()).toBe(true);
    expect(user.isNewRecord()).toBe(false);
    expect(user.id).toBeTypeOf("number");
    expect(user.isActive).toBe(true); // column default, because isActive wasn't assigned
    expect((await users.find(user.id)).email).toBe("a@example.com");
  });

  test("an app-generated key from a default is inserted as given", async () => {
    const keys = harness.connect().model(ApiKey);
    const key = keys.build({ label: "deploy", scopes: ["read"] });
    const id = key.id;

    await key.save();

    expect(key.id).toBe(id);
    expect((await keys.find(id)).scopes).toEqual(["read"]);
  });

  test("create and createOrThrow build and save in one step, resolving to the record", async () => {
    const users = harness.connect().model(User);

    const created = await users.create({ email: "a@example.com", role: "admin" });
    const createdOrThrow = await users.createOrThrow({ email: "b@example.com" });

    expect(created).toBeInstanceOf(User);
    expect(created.isPersisted()).toBe(true);
    expect(createdOrThrow.isPersisted()).toBe(true);
    expect(await users.order({ id: "asc" }).pluck("email")).toEqual([
      "a@example.com",
      "b@example.com",
    ]);
  });

  test("saving a loaded record updates only its changed columns", async () => {
    await harness.connect().model(User).create({ email: "a@example.com", role: "member" });
    const queries: QueryEvent[] = [];
    const users = harness.connect({ onQuery: (event) => queries.push(event) }).model(User);
    const user = await users.findByOrThrow({ email: "a@example.com" });
    queries.length = 0;

    user.role = "admin";
    expect(await user.save()).toBe(true);

    expect(queries).toHaveLength(1);
    const update = harness.asSent('UPDATE "users" SET "role" = ?');
    expect(queries[0]?.sql.slice(0, update.length)).toBe(update);
    expect(queries[0]?.sql).not.toContain('"email"');
    expect((await users.find(user.id)).role).toBe("admin");
  });

  test("saving a record with no changes sends no statement", async () => {
    await harness.connect().model(User).create({ email: "a@example.com" });
    const queries: QueryEvent[] = [];
    const users = harness.connect({ onQuery: (event) => queries.push(event) }).model(User);
    const user = await users.findByOrThrow({ email: "a@example.com" });
    queries.length = 0;

    user.email = "a@example.com"; // assigned, but unchanged

    expect(await user.save()).toBe(true);
    expect(queries).toHaveLength(0);
  });

  test("assign sets several attributes without saving, rejecting unknown keys and undefined", async () => {
    const queries: QueryEvent[] = [];
    const users = harness.connect({ onQuery: (event) => queries.push(event) }).model(User);
    const user = users.build({ email: "a@example.com" });

    user.assign({ role: "admin", isActive: false });

    expect(user.changes()).toMatchObject({ role: [null, "admin"], isActive: [null, false] });
    expect(queries).toHaveLength(0);
    // @ts-expect-error unknown attribute
    expect(() => user.assign({ nope: 1 })).toThrow(UnknownAttribute);
    expect(() => user.assign({ role: undefined })).toThrow(/"role".*null/);
    expect(() => users.build({ role: undefined })).toThrow(TypeError);
  });

  test("update and updateOrThrow assign and save in one step", async () => {
    const users = harness.connect().model(User);
    const user = await users.create({ email: "a@example.com", role: "member" });

    expect(await user.update({ role: "admin" })).toBe(true);
    expect(await user.updateOrThrow({ isActive: false })).toBe(true);

    const stored = await users.find(user.id);
    expect([stored.role, stored.isActive]).toEqual(["admin", false]);
  });

  test("reload discards unsaved changes and loads the stored row", async () => {
    const users = harness.connect().model(User);
    const user = await users.create({ email: "a@example.com", role: "member" });
    await harness.exec("UPDATE users SET role = 'owner' WHERE id = ?", [user.id]);
    user.email = "changed@example.com";

    await user.reload();

    expect(user.email).toBe("a@example.com");
    expect(user.role).toBe("owner");
    expect(user.isChanged()).toBe(false);
  });

  test("reload throws RecordNotFound when the row is gone", async () => {
    const user = await harness.connect().model(User).create({ email: "a@example.com" });
    await harness.exec("DELETE FROM users");

    await expect(user.reload()).rejects.toThrow(RecordNotFound);
  });

  test("building from a relation inherits its single equality values; explicit ones win", async () => {
    const users = harness.connect().model(User);
    const admins = users
      .where({ role: "admin", id: [1, 2] })
      .whereNot({ email: "x@example.com" })
      .where(sql`email LIKE ${"%@example.com"}`);

    const built = admins.build({ email: "a@example.com" });
    const overridden = admins.build({ email: "b@example.com", role: "member" });
    const created = await admins.create({ email: "c@example.com" });

    expect(built.changes()).toEqual({ email: [null, "a@example.com"], role: [null, "admin"] });
    expect(overridden.role).toBe("member");
    expect((await users.find(created.id)).role).toBe("admin");
  });

  test("destroy deletes the row; the record stays readable as a destroyed snapshot", async () => {
    const users = harness.connect().model(User);
    const user = await users.create({ email: "a@example.com" });

    expect(await user.destroy()).toBe(user);

    expect(user.isDestroyed()).toBe(true);
    expect(user.isPersisted()).toBe(false);
    expect(user.email).toBe("a@example.com");
    expect(await users.exists({ id: user.id })).toBe(false);
  });

  test("destroyOrThrow resolves to the record, and a row that's already gone still counts", async () => {
    const user = await harness.connect().model(User).create({ email: "a@example.com" });
    await harness.exec("DELETE FROM users");

    expect(await user.destroyOrThrow()).toBe(user);
    expect(user.isDestroyed()).toBe(true);
  });

  test("using a destroyed record as a live one throws RecordDestroyed", async () => {
    const user = await harness.connect().model(User).create({ email: "a@example.com" });
    await user.destroy();

    await expect(user.save()).rejects.toThrow(RecordDestroyed);
    await expect(user.saveOrThrow()).rejects.toThrow(RecordDestroyed);
    await expect(user.update({ role: "admin" })).rejects.toThrow(RecordDestroyed);
    await expect(user.destroy()).rejects.toThrow(RecordDestroyed);
    await expect(user.reload()).rejects.toThrow(/User.*destroyed/);
  });

  test("a record constructed directly has no Database, so it can't be saved or loaded", async () => {
    const user = new User();

    await expect(user.save()).rejects.toThrow(NoDatabase);
    await expect(user.reload()).rejects.toThrow(/User.*db\.model\(User\)/);
    await expect(harness.connect().model(User).build().reload()).rejects.toThrow(RecordNotFound);
  });

  test("a keyless record from select(...).distinct() can't be saved, updated, destroyed or reloaded", async () => {
    const users = harness.connect().model(User);
    await users.create({ email: "a@example.com", role: "admin" });
    const [role] = await users.select("role").distinct().toArray();
    if (!role) throw new Error("expected a record");

    await expect(role.update({ role: "member" })).rejects.toThrow(MissingAttribute);
    await expect(role.save()).rejects.toThrow(/primary key.*distinct/);
    await expect(role.destroy()).rejects.toThrow(MissingAttribute);
    await expect(role.reload()).rejects.toThrow(MissingAttribute);
    expect(await users.pluck("role")).toEqual(["admin"]);
  });

  test("destroying a never-saved record sends nothing: there's no row to delete", async () => {
    const queries: QueryEvent[] = [];
    const user = harness
      .connect({ onQuery: (event) => queries.push(event) })
      .model(User)
      .build({ email: "a@example.com" });

    expect(await user.destroy()).toBe(user);

    expect(user.isDestroyed()).toBe(true);
    expect(queries).toHaveLength(0);
  });

  test("changing the primary key updates the row found by its stored key", async () => {
    const users = harness.connect().model(User);
    const user = await users.create({ email: "a@example.com" });
    const oldId = user.id;

    user.id = oldId + 100;
    await user.save();

    expect(await users.exists({ id: oldId })).toBe(false);
    expect((await users.find(oldId + 100)).email).toBe("a@example.com");
  });

  test("saving a record whose row was deleted elsewhere still succeeds", async () => {
    const user = await harness.connect().model(User).create({ email: "a@example.com" });
    await harness.exec("DELETE FROM users");

    user.role = "admin";

    expect(await user.save()).toBe(true);
    expect(user.isChanged()).toBe(false);
  });

  test("saving a partial record writes only its changes and leaves unloaded columns alone", async () => {
    const users = harness.connect().model(User);
    const created = await users.create({ email: "a@example.com", role: "admin" });
    const [partial] = await users.select("email").toArray();
    if (!partial) throw new Error("expected a record");

    partial.email = "b@example.com";
    await partial.save();

    const stored = await users.find(created.id);
    expect([stored.email, stored.role]).toEqual(["b@example.com", "admin"]);
  });

  test("a keyless record can still be changed in memory; it just can't be saved", async () => {
    const users = harness.connect().model(User);
    await users.create({ email: "a@example.com", role: "admin" });
    const [role] = await users.select("role").distinct().toArray();
    if (!role) throw new Error("expected a record");

    role.role = "member";
    role.assign({ role: "owner" });

    expect(role.changes()).toEqual({ role: ["admin", "owner"] });
    await expect(role.save()).rejects.toThrow(MissingAttribute);
  });

  test("a loaded record rejects undefined when a property is set", async () => {
    const users = harness.connect().model(User);
    const user = await users.findByOrThrow({
      email: (await users.create({ email: "a@example.com" })).email,
    });

    expect(() => {
      user.role = undefined as never;
    }).toThrow(TypeError);
    expect(user.isChanged()).toBe(false);
  });

  test("after a real DELETE the record is read-only, even when assigning undefined", async () => {
    const users = harness.connect().model(User);
    const user = await users.create({ email: "a@example.com" });
    await user.destroy();

    expect(() => {
      user.role = "admin";
    }).toThrow(RecordDestroyed);
    expect(() => {
      user.role = undefined as never;
    }).toThrow(RecordDestroyed);
    expect(() => user.assign({ role: "admin" })).toThrow(RecordDestroyed);
    expect(user.email).toBe("a@example.com");
  });
});
