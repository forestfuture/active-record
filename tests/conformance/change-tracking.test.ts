import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  MissingAttribute,
  Model,
  RecordDestroyed,
} from "../../packages/active-record/src/index.ts";
import { openHarness, type Harness } from "../support/harness.ts";

class User extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  role: "string",
}) {
  static table = "users";
}

class Draft extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  role: { type: "string", default: () => "member" },
}) {
  static table = "users";
}

/** A user whose every attribute has a default, or a key the database assigns. */
class Member extends Model.define({
  id: "integer",
  email: { type: "string", null: false, default: () => "new@example.com" },
  role: { type: "string", default: () => "member" },
}) {
  static table = "users";
}

/** A key whose scopes default to a JSON value. */
class ReadKey extends Model.define({
  id: { type: "string", null: false },
  label: { type: "string", null: false },
  scopes: { type: "json", default: () => ["read"] },
}) {
  static table = "api_keys";

  static {
    this.beforeSave((key) => {
      if (key.willSaveChangeTo("scopes")) key.label = `${key.label} (custom scopes)`;
    });
  }
}

class ApiKey extends Model.define({
  id: { type: "string", null: false },
  label: { type: "string", null: false },
  scopes: "json",
  expiresAt: "datetime",
}) {
  static table = "api_keys";
}

describe("change tracking", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.reset("users", "api_keys");
    await harness.exec("INSERT INTO users (id, email, role) VALUES (1, 'a@example.com', 'member')");
    await harness.exec(`INSERT INTO api_keys (id, label, scopes, expires_at)
         VALUES ('k1', 'deploy', '["read"]', '2026-01-01T00:00:00.000Z')`);
  });

  test("a loaded record is clean; assigning reports what changed and from what", async () => {
    const user = await harness.connect().model(User).find(1);
    expect(user.isChanged()).toBe(false);

    user.role = "admin";

    expect(user.isChanged()).toBe(true);
    expect(user.changed()).toEqual(["role"]);
    expect(user.changedAttributes()).toEqual({ role: "member" });
    expect(user.changes()).toEqual({ role: ["member", "admin"] });
  });

  test("assigning the original value back is not a change", async () => {
    const user = await harness.connect().model(User).find(1);

    user.role = "admin";
    user.role = "member";

    expect(user.isChanged()).toBe(false);
  });

  test("in-place changes to json values and dates are detected", async () => {
    const key = await harness.connect().model(ApiKey).find("k1");

    (key.scopes as string[]).push("write");
    key.expiresAt?.setUTCFullYear(2030);

    expect(key.changed().sort()).toEqual(["expiresAt", "scopes"]);
    expect(key.changes()["scopes"]).toEqual([["read"], ["read", "write"]]);
    expect(key.changes()["expiresAt"]).toEqual([
      new Date("2026-01-01T00:00:00.000Z"),
      new Date("2030-01-01T00:00:00.000Z"),
    ]);
    expect(key.attributeWas("expiresAt")).toEqual(new Date("2026-01-01T00:00:00.000Z"));
  });

  test("a new record's changes are its assigned attributes", () => {
    const user = harness.connect().model(User).build({ email: "b@example.com" });

    expect(user.changed()).toEqual(["email"]);
    expect(user.changes()).toEqual({ email: [null, "b@example.com"] });
  });

  test("a new record's changes run from its declared defaults, which aren't changes", () => {
    const draft = harness.connect().model(Draft).build({ email: "b@example.com", role: "admin" });

    expect(draft.changes()).toEqual({
      email: [null, "b@example.com"],
      role: ["member", "admin"],
    });
  });

  test("a new record holding only its defaults isn't changed", () => {
    const member = harness.connect().model(Member).build();

    expect(member.isChanged()).toBe(false);
    expect(member.changed()).toEqual([]);
  });

  test("assigning a new record its default's value isn't a change", () => {
    const member = harness.connect().model(Member).build({ role: "member" });

    expect(member.changed()).toEqual([]);
  });

  test("assigning a new record's default back undoes the change", () => {
    const member = harness.connect().model(Member).build({ role: "admin" });

    member.role = "member";

    expect(member.isChanged()).toBe(false);
  });

  test("an equal copy of a JSON default isn't a change", () => {
    const key = harness
      .connect()
      .model(ReadKey)
      .build({ id: "k2", label: "ci", scopes: ["read"] });

    expect(key.changed()).toEqual(["id", "label"]);
  });

  test("a before-callback sees a default it kept as unchanged", async () => {
    const key = await harness.connect().model(ReadKey).createOrThrow({ id: "k2", label: "ci" });

    expect(key.label).toBe("ci");
  });

  test("a new record holding only its defaults is still inserted, with them", async () => {
    const db = harness.connect();
    const member = db.model(Member).build();

    expect(await member.save()).toBe(true);
    expect(await db.model(User).where({ id: member.id! }).pluck("email", "role")).toEqual([
      ["new@example.com", "member"],
    ]);
  });

  test("after create, savedChanges leaves out a default that wasn't changed", async () => {
    const draft = await harness.connect().model(Draft).createOrThrow({ email: "b@example.com" });

    expect(draft.savedChanges()).toEqual({
      id: [null, draft.id],
      email: [null, "b@example.com"],
    });
  });

  test("savedChanges holds the last save's changes, and the record is clean after saving", async () => {
    const user = await harness.connect().model(User).find(1);
    user.role = "admin";

    await user.save();

    expect(user.isChanged()).toBe(false);
    expect(user.savedChanges()).toEqual({ role: ["member", "admin"] });
    await user.save();
    expect(user.savedChanges()).toEqual({});
  });

  test("savedChanges holds copies, so editing the record afterwards doesn't change it", async () => {
    const key = await harness.connect().model(ApiKey).find("k1");
    key.scopes = ["read", "write"];
    await key.save();

    (key.scopes as string[]).push("admin");

    expect(key.savedChanges()).toEqual({ scopes: [["read"], ["read", "write"]] });
  });

  test("after create, savedChanges includes what the database filled in, like the generated key", async () => {
    const user = await harness.connect().model(User).create({ email: "b@example.com" });

    expect(user.savedChanges()).toEqual({
      id: [null, user.id],
      email: [null, "b@example.com"],
    });
  });

  describe("per attribute", () => {
    test("attributeWas() is the value before the current change, as stored", async () => {
      const user = await harness.connect().model(User).find(1);

      user.role = "admin";

      expect(user.attributeWas("role")).toBe("member");
      expect(user.attributeWas("email")).toBe("a@example.com");
      expect(harness.connect().model(User).build({ role: "x" }).attributeWas("role")).toBeNull();
    });

    test("isAttributeChanged() and willSaveChangeTo(), optionally from and to given values", async () => {
      const key = await harness.connect().model(ApiKey).find("k1");

      key.expiresAt = new Date("2027-01-01T00:00:00.000Z");

      expect(key.isAttributeChanged("expiresAt")).toBe(true);
      expect(key.isAttributeChanged("label")).toBe(false);
      expect(
        key.isAttributeChanged("expiresAt", {
          from: new Date("2026-01-01T00:00:00.000Z"),
          to: new Date("2027-01-01T00:00:00.000Z"),
        }),
      ).toBe(true);
      expect(key.isAttributeChanged("expiresAt", { from: new Date(0) })).toBe(false);
      expect(key.willSaveChangeTo("expiresAt")).toBe(true);
      expect(key.willSaveChangeTo("label")).toBe(false);
    });

    test("after a save: savedChangeTo(), hasSavedChangeTo() and attributeBeforeLastSave()", async () => {
      const user = await harness.connect().model(User).find(1);
      user.role = "admin";
      await user.saveOrThrow();

      expect(user.savedChangeTo("role")).toEqual(["member", "admin"]);
      expect(user.savedChangeTo("email")).toBeUndefined();
      expect(user.hasSavedChangeTo("role", { from: "member" })).toBe(true);
      expect(user.hasSavedChangeTo("email")).toBe(false);
      expect(user.attributeBeforeLastSave("role")).toBe("member");
      expect(user.attributeBeforeLastSave("email")).toBe("a@example.com");
      expect(user.willSaveChangeTo("role")).toBe(false);
    });

    test("restoreAttributes() undoes unsaved changes, to some attributes or all", async () => {
      const key = await harness.connect().model(ApiKey).find("k1");
      key.label = "release";
      key.scopes = ["write"];

      key.restoreAttributes(["label"]);
      expect([key.label, key.changed()]).toEqual(["deploy", ["scopes"]]);

      key.restoreAttributes();
      expect([key.scopes, key.isChanged()]).toEqual([["read"], false]);
    });

    test("a new record's restoreAttributes() returns attributes to their defaults, as in Rails", () => {
      const draft = harness.connect().model(Draft).build({ email: "a@example.com", role: "admin" });

      draft.restoreAttributes();

      expect([draft.email, draft.role]).toEqual([null, "member"]);
    });

    test("an attribute that wasn't loaded throws MissingAttribute, as reading it does", async () => {
      const [partial] = await harness.connect().model(User).select("email").toArray();

      expect(() => partial!.attributeWas("role")).toThrow(MissingAttribute);
      expect(() => partial!.savedChangeTo("role")).toThrow(MissingAttribute);
      expect(() => partial!.hasSavedChangeTo("role")).toThrow(MissingAttribute);
      expect(() => partial!.attributeBeforeLastSave("role")).toThrow(MissingAttribute);
    });

    test("a new record's value before a change is its declared default, as in Rails", () => {
      const draft = harness.connect().model(Draft).build({ email: "a@example.com" });
      draft.role = "admin";

      expect(draft.attributeWas("role")).toBe("member");
      expect(draft.isAttributeChanged("role", { from: "member", to: "admin" })).toBe(true);
      expect(draft.attributeWas("email")).toBeNull();
    });

    test("after a create, savedChangeTo() runs from null", async () => {
      const user = await harness
        .connect()
        .model(User)
        .createOrThrow({ id: 2, email: "b@example.com" });

      expect(user.savedChangeTo("email")).toEqual([null, "b@example.com"]);
    });

    test("json compares by content, and from: null is a real condition", async () => {
      const key = await harness.connect().model(ApiKey).find("k1");
      const user = await harness.connect().model(User).find(1);
      key.scopes = ["read", "write"];
      user.role = null;

      expect(key.isAttributeChanged("scopes", { from: ["read"], to: ["read", "write"] })).toBe(
        true,
      );
      expect(user.isAttributeChanged("role", { from: "member", to: null })).toBe(true);
      expect(user.isAttributeChanged("role", { from: null })).toBe(false);
    });

    test("a destroyed record can't restore its attributes", async () => {
      const user = await harness.connect().model(User).find(1);
      await user.destroyOrThrow();

      expect(() => user.restoreAttributes()).toThrow(RecordDestroyed);
    });
  });
});
