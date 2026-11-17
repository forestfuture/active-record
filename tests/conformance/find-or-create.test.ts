import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  Model,
  RecordInvalid,
  RecordNotFound,
  RecordNotUnique,
} from "../../packages/active-record/src/index.ts";
import type { QueryEvent } from "../../packages/active-record/src/executor.ts";
import { openHarness, type Harness } from "../support/harness.ts";
import { statementKinds } from "../support/statement-kinds.ts";

class User extends Model.define({
  id: { type: "integer", null: false },
  email: "string",
  role: "string",
  age: "integer",
}) {
  static table = "users";

  static {
    this.validates("email", { presence: true });
  }
}

describe("making records", () => {
  let harness: Harness;
  const events: QueryEvent[] = [];
  const db = () => harness.connect({ onQuery: (event) => events.push(event) });
  const emails = async () =>
    (await harness.exec("SELECT email, role FROM users ORDER BY id")).map(({ email, role }) => ({
      email,
      role,
    }));

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.reset("posts", "users");
    await harness.exec(
      "INSERT INTO users (id, email, role) VALUES (1, 'taken@example.com', 'admin')",
    );
    events.length = 0;
  });

  describe("init", () => {
    test("build hands init the new record, its attributes assigned, before returning it", () => {
      const seen: unknown[] = [];

      const user = db()
        .model(User)
        .build({ email: "new@example.com" }, (record) => {
          seen.push(record.email);
          record.role = "member";
        });

      expect(seen).toEqual(["new@example.com"]);
      expect(user.role).toBe("member");
      expect(user.isNewRecord()).toBe(true);
    });

    test("create awaits init before saving, so what it sets is saved", async () => {
      const user = await db()
        .model(User)
        .create({ email: "new@example.com" }, async (record) => {
          await Promise.resolve();
          record.role = "member";
        });

      expect(user.isPersisted()).toBe(true);
      expect(await emails()).toContainEqual({ email: "new@example.com", role: "member" });
    });

    test("createOrThrow awaits init before saving, so what it sets is saved", async () => {
      await db()
        .model(User)
        .createOrThrow({ email: "new@example.com" }, (record) => {
          record.role = "member";
        });

      expect(await emails()).toContainEqual({ email: "new@example.com", role: "member" });
      expect(statementKinds(events)).toEqual(["INSERT"]);
    });
  });

  describe("findOrCreateBy", () => {
    test("finds the row with the attributes, and writes nothing", async () => {
      const user = await db().model(User).findOrCreateBy({ email: "taken@example.com" });

      expect(user.id).toBe(1);
      expect(user.role).toBe("admin");
      expect(statementKinds(events)).toEqual(["SELECT"]);
    });

    test("creates a row with the attributes when none has them", async () => {
      const user = await db()
        .model(User)
        .findOrCreateBy({ email: "new@example.com", role: "member" });

      expect(user.isPersisted()).toBe(true);
      expect(await emails()).toContainEqual({ email: "new@example.com", role: "member" });
      expect(statementKinds(events)).toEqual(["SELECT", "INSERT"]);
    });

    test("hands init the record it creates, before saving it", async () => {
      await db()
        .model(User)
        .findOrCreateBy({ email: "new@example.com" }, (user) => {
          user.role = "member";
        });

      expect(await emails()).toContainEqual({ email: "new@example.com", role: "member" });
    });

    test("doesn't call init when it finds the row", async () => {
      const calls: unknown[] = [];

      await db()
        .model(User)
        .findOrCreateBy({ email: "taken@example.com" }, (user) => void calls.push(user));

      expect(calls).toEqual([]);
    });

    test("resolves to the unsaved record when it can't be saved", async () => {
      const user = await db().model(User).findOrCreateBy({ email: null, role: "member" });

      expect(user.isNewRecord()).toBe(true);
      expect(user.errors.get("email")).toEqual(["can't be blank"]);
      expect(statementKinds(events)).toEqual(["SELECT"]);
    });
  });

  describe("findOrCreateByOrThrow", () => {
    test("finds the row with the attributes, and writes nothing", async () => {
      const user = await db().model(User).findOrCreateByOrThrow({ email: "taken@example.com" });

      expect(user.id).toBe(1);
      expect(statementKinds(events)).toEqual(["SELECT"]);
    });

    test("creates a row with the attributes when none has them, handing it to init", async () => {
      await db()
        .model(User)
        .findOrCreateByOrThrow({ email: "new@example.com" }, (user) => {
          user.role = "member";
        });

      expect(await emails()).toContainEqual({ email: "new@example.com", role: "member" });
    });

    test("throws RecordInvalid when the record it creates can't be saved", async () => {
      await expect(db().model(User).findOrCreateByOrThrow({ email: null })).rejects.toThrow(
        RecordInvalid,
      );
    });
  });

  describe("findOrInitializeBy", () => {
    test("finds the row with the attributes", async () => {
      const user = await db().model(User).findOrInitializeBy({ email: "taken@example.com" });

      expect(user.id).toBe(1);
      expect(user.isPersisted()).toBe(true);
    });

    test("builds a record with the attributes, awaiting init, and writes nothing", async () => {
      const user = await db()
        .model(User)
        .findOrInitializeBy({ email: "new@example.com" }, async (record) => {
          await Promise.resolve();
          record.role = "member";
        });

      expect(user.isNewRecord()).toBe(true);
      expect({ email: user.email, role: user.role }).toEqual({
        email: "new@example.com",
        role: "member",
      });
      expect(statementKinds(events)).toEqual(["SELECT"]);
    });

    test("doesn't call init when it finds the row", async () => {
      const calls: unknown[] = [];

      await db()
        .model(User)
        .findOrInitializeBy({ email: "taken@example.com" }, (user) => void calls.push(user));

      expect(calls).toEqual([]);
    });
  });

  describe("createOrFindBy", () => {
    test("creates a row with the attributes, without looking for one first", async () => {
      const user = await db()
        .model(User)
        .createOrFindBy({ email: "new@example.com" }, (record) => {
          record.role = "member";
        });

      expect(user.isPersisted()).toBe(true);
      expect(await emails()).toContainEqual({ email: "new@example.com", role: "member" });
      expect(statementKinds(events)).toEqual(["INSERT"]);
    });

    test("finds the row a unique index refused a duplicate of", async () => {
      const user = await db().model(User).createOrFindBy({ email: "taken@example.com" });

      expect(user.id).toBe(1);
      expect(user.role).toBe("admin");
      expect(statementKinds(events)).toEqual(["INSERT", "SELECT"]);
    });

    test("resolves to the unsaved record, without finding, when it can't be saved", async () => {
      const user = await db().model(User).createOrFindBy({ email: null });

      expect(user.isNewRecord()).toBe(true);
      expect(statementKinds(events)).toEqual([]);
    });

    test("throws RecordNotFound when the duplicate was in a column the attributes don't name", async () => {
      const creating = db()
        .model(User)
        .createOrFindBy({ email: "new@example.com" }, (user) => {
          user.id = 1;
        });

      await expect(creating).rejects.toThrow(RecordNotFound);
    });
  });

  describe("a row inserted between finding and creating", () => {
    const insertAnother = () =>
      harness.exec("INSERT INTO users (id, email, role) VALUES (2, 'new@example.com', 'other')");

    test("is what createOrFindBy finds", async () => {
      const user = await db()
        .model(User)
        .createOrFindBy({ email: "new@example.com" }, () => insertAnother().then(() => {}));

      expect(user.id).toBe(2);
      expect(user.role).toBe("other");
    });

    test("makes findOrCreateBy throw RecordNotUnique", async () => {
      const finding = db()
        .model(User)
        .findOrCreateBy({ email: "new@example.com" }, () => insertAnother().then(() => {}));

      await expect(finding).rejects.toThrow(RecordNotUnique);
    });
  });
});
