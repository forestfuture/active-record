import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { abort, AbortAfterPersistence, Model, RecordNotDestroyed } from "../../src/index.ts";
import { openHarness, type Harness } from "../support/harness.ts";

const log: string[] = [];
const hooks: { beforeDestroy?: () => void; afterDestroy?: () => void } = {};

class User extends Model.define({
  id: { type: "integer", null: false },
  email: "string",
}) {
  static table = "users";

  static {
    this.beforeDestroy(() => {
      log.push("beforeDestroy");
      hooks.beforeDestroy?.();
    });
    this.afterDestroy((user) => {
      log.push(`afterDestroy (destroyed: ${user.isDestroyed()})`);
      hooks.afterDestroy?.();
    });
  }
}

describe("destroy callbacks", () => {
  let harness: Harness;
  const users = () =>
    harness.connect({ onQuery: (event) => log.push(event.sql.split(" ")[0] ?? "") }).model(User);

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.exec("DELETE FROM users");
    delete hooks.beforeDestroy;
    delete hooks.afterDestroy;
  });

  test("destroying runs beforeDestroy, the DELETE, then afterDestroy on the destroyed record", async () => {
    const user = await users().create({ email: "a@example.com" });
    log.length = 0;

    await user.destroy();

    expect(log).toEqual(["beforeDestroy", "DELETE", "afterDestroy (destroyed: true)"]);
  });

  test("abort() in beforeDestroy refuses: destroy() is false, destroyOrThrow throws, nothing is deleted", async () => {
    hooks.beforeDestroy = () => {
      throw abort("Account has open invoices");
    };
    const user = await users().create({ email: "a@example.com" });

    expect(await user.destroy()).toBe(false);
    expect(user.abortReason).toBe("Account has open invoices");
    await expect(user.destroyOrThrow()).rejects.toThrow(RecordNotDestroyed);
    expect(user.isDestroyed()).toBe(false);
    expect(await users().count()).toBe(1);

    delete hooks.beforeDestroy;
    await user.destroy();
    expect(user.abortReason).toBeUndefined(); // cleared at the start of each destroy
  });

  test("an error from afterDestroy propagates; the row stays deleted and the record destroyed", async () => {
    const failure = new Error("cleanup failed");
    hooks.afterDestroy = () => {
      throw failure;
    };
    const user = await users().create({ email: "a@example.com" });

    await expect(user.destroy()).rejects.toBe(failure);
    expect(user.isDestroyed()).toBe(true);
    expect(await users().count()).toBe(0);

    hooks.afterDestroy = () => {
      throw abort("too late");
    };
    const other = await users().create({ email: "b@example.com" });
    await expect(other.destroy()).rejects.toThrow(AbortAfterPersistence);
    expect(other.isDestroyed()).toBe(true);
  });
});
