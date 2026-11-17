import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { Model } from "../../packages/active-record/src/index.ts";
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
});
