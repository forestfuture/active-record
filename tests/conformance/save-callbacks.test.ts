import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  abort,
  AbortAfterPersistence,
  CallbackAbort,
  Model,
} from "../../packages/active-record/src/index.ts";
import { openHarness, type Harness } from "../support/harness.ts";

const log: string[] = [];
type Hook = (user: User) => void;
const hooks: Partial<
  Record<
    "beforeSave" | "beforeCreate" | "beforeUpdate" | "afterCreate" | "afterUpdate" | "afterSave",
    Hook
  >
> = {};

class User extends Model.define({
  id: { type: "integer", null: false },
  email: "string",
  role: "string",
}) {
  static table = "users";

  static {
    this.beforeValidation(() => void log.push("beforeValidation"));
    this.afterValidation(() => void log.push("afterValidation"));
    this.beforeSave((user) => {
      log.push("beforeSave");
      hooks.beforeSave?.(user);
    });
    this.beforeCreate((user) => {
      log.push("beforeCreate");
      hooks.beforeCreate?.(user);
    });
    this.beforeUpdate((user) => {
      log.push("beforeUpdate");
      hooks.beforeUpdate?.(user);
    });
    this.afterCreate((user) => {
      log.push(`afterCreate (persisted: ${user.isPersisted()})`);
      hooks.afterCreate?.(user);
    });
    this.afterUpdate((user) => {
      log.push("afterUpdate");
      hooks.afterUpdate?.(user);
    });
    this.afterSave((user) => {
      log.push("afterSave");
      hooks.afterSave?.(user);
    });
  }
}

describe("save callbacks", () => {
  let harness: Harness;
  const users = () =>
    harness.connect({ onQuery: (event) => log.push(event.sql.split(" ")[0] ?? "") }).model(User);

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.exec("DELETE FROM users");
    log.length = 0;
    for (const name of Object.keys(hooks)) delete hooks[name as keyof typeof hooks];
  });

  test("creating runs the create callbacks around the INSERT", async () => {
    await users().create({ email: "a@example.com" });

    expect(log).toEqual([
      "beforeValidation",
      "afterValidation",
      "beforeSave",
      "beforeCreate",
      "INSERT",
      "afterCreate (persisted: true)",
      "afterSave",
    ]);
  });

  test("updating runs the update callbacks around the UPDATE", async () => {
    const user = await users().create({ email: "a@example.com" });
    log.length = 0;

    await user.update({ role: "admin" });

    expect(log).toEqual([
      "beforeValidation",
      "afterValidation",
      "beforeSave",
      "beforeUpdate",
      "UPDATE",
      "afterUpdate",
      "afterSave",
    ]);
  });

  test("a clean save runs every callback but sends no UPDATE", async () => {
    const user = await users().create({ email: "a@example.com" });
    log.length = 0;

    expect(await user.save()).toBe(true);

    expect(log).toEqual([
      "beforeValidation",
      "afterValidation",
      "beforeSave",
      "beforeUpdate",
      "afterUpdate",
      "afterSave",
    ]);
  });

  test("a change made in beforeSave is written", async () => {
    const user = await users().create({ email: "a@example.com" });
    hooks.beforeSave = (record) => {
      record.role = "member";
    };

    await user.save();

    expect(log).toContain("UPDATE");
    expect((await users().find(user.id)).role).toBe("member");
  });

  test("abort() in a before-save callback refuses the save: false, no write, nothing persisted", async () => {
    hooks.beforeSave = () => {
      throw abort("Signups are closed");
    };
    const user = users().build({ email: "a@example.com" });

    expect(await user.save()).toBe(false);

    expect(log).not.toContain("INSERT");
    expect(log).not.toContain("afterSave");
    expect(user.isNewRecord()).toBe(true);
    expect(user.abortReason).toBe("Signups are closed");
  });

  test("a change made in afterSave leaves the record dirty; no second write happens", async () => {
    hooks.afterSave = (record) => {
      record.role = "changed afterwards";
    };

    const user = await users().create({ email: "a@example.com" });

    expect(log.filter((entry) => entry === "INSERT" || entry === "UPDATE")).toEqual(["INSERT"]);
    expect(user.changed()).toEqual(["role"]);
  });

  test("an error from afterSave propagates, but the row stays written and the record persisted", async () => {
    const failure = new Error("audit log unavailable");
    hooks.afterSave = () => {
      throw failure;
    };
    const user = users().build({ email: "a@example.com" });

    await expect(user.save()).rejects.toBe(failure);

    expect(user.isPersisted()).toBe(true);
    expect(user.isChanged()).toBe(false);
    expect(await users().count()).toBe(1);
  });

  test("abort() after the write becomes AbortAfterPersistence; the save still happened", async () => {
    hooks.afterSave = () => {
      throw abort("too late");
    };
    const user = users().build({ email: "a@example.com" });

    const error = await user.save().catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AbortAfterPersistence);
    expect(error).toMatchObject({ callback: "afterSave", reason: "too late" });
    expect((error as Error).cause).toBeInstanceOf(CallbackAbort);
    expect((error as Error).message).toMatch(/afterSave.*already succeeded/);
    expect(user.isPersisted()).toBe(true);
    expect(await users().count()).toBe(1);
  });

  test("abort() in beforeCreate or beforeUpdate refuses the save", async () => {
    hooks.beforeCreate = () => {
      throw abort("no creates");
    };
    const user = users().build({ email: "a@example.com" });
    expect(await user.save()).toBe(false);
    expect(user.abortReason).toBe("no creates");
    delete hooks.beforeCreate;

    await user.save();
    expect(user.abortReason).toBeUndefined(); // cleared at the start of each save
    hooks.beforeUpdate = () => {
      throw abort("no updates");
    };
    expect(await user.update({ role: "admin" })).toBe(false);
    expect((await users().find(user.id)).role).toBeNull();
  });

  test("abort() in afterCreate or afterUpdate becomes AbortAfterPersistence", async () => {
    hooks.afterCreate = () => {
      throw abort("late create");
    };
    const created = users().build({ email: "a@example.com" });
    await expect(created.save()).rejects.toMatchObject({
      callback: "afterCreate",
      reason: "late create",
    });
    expect(created.isPersisted()).toBe(true);
    delete hooks.afterCreate;

    hooks.afterUpdate = () => {
      throw abort("late update");
    };
    await expect(created.update({ role: "admin" })).rejects.toThrow(AbortAfterPersistence);
    expect((await users().find(created.id)).role).toBe("admin");
  });
});
