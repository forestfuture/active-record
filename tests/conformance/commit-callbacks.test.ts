import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { abort, AbortAfterPersistence, Model } from "../../packages/active-record/src/index.ts";
import { openHarness, type Harness } from "../support/harness.ts";

const log: string[] = [];
const hooks: { afterCommit?: (user: User) => void; afterSave?: () => void } = {};

class User extends Model.define({
  id: { type: "integer", null: false },
  email: "string",
  role: "string",
}) {
  static table = "users";

  static {
    this.afterCommit((user) => {
      log.push(`afterCommit ${user.email}`);
      hooks.afterCommit?.(user);
    });
    this.afterSave((user) => {
      log.push(`afterSave ${user.email}`);
      hooks.afterSave?.();
    });
    this.afterCreateCommit((user) => void log.push(`afterCreateCommit ${user.email}`));
    this.afterUpdateCommit((user) => void log.push(`afterUpdateCommit ${user.email}`));
    this.afterSaveCommit((user) => void log.push(`afterSaveCommit ${user.email}`));
    this.afterDestroyCommit((user) => void log.push(`afterDestroyCommit ${user.email}`));
    this.afterDestroy((user) => void log.push(`afterDestroy ${user.email}`));
  }
}

describe("commit callbacks", () => {
  let harness: Harness;
  const users = () =>
    harness.connect({ onQuery: (event) => log.push(event.sql.split(" ")[0] ?? "") }).model(User);

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.reset("users");
    log.length = 0;
    delete hooks.afterCommit;
    delete hooks.afterSave;
  });

  test("creating runs the create commit callbacks after every after-callback, in declaration order", async () => {
    await users().create({ email: "a@example.com" });

    expect(log).toEqual([
      "INSERT",
      "afterSave a@example.com",
      "afterCommit a@example.com",
      "afterCreateCommit a@example.com",
      "afterSaveCommit a@example.com",
    ]);
  });

  test("updating runs the update commit callbacks", async () => {
    const user = await users().create({ email: "a@example.com" });
    log.length = 0;

    await user.update({ role: "admin" });

    expect(log).toEqual([
      "UPDATE",
      "afterSave a@example.com",
      "afterCommit a@example.com",
      "afterUpdateCommit a@example.com",
      "afterSaveCommit a@example.com",
    ]);
  });

  test("a clean save, with nothing to write, runs the update commit callbacks", async () => {
    const user = await users().create({ email: "a@example.com" });
    log.length = 0;

    await user.save();

    expect(log).toEqual([
      "afterSave a@example.com",
      "afterCommit a@example.com",
      "afterUpdateCommit a@example.com",
      "afterSaveCommit a@example.com",
    ]);
  });

  test("destroying runs the destroy commit callbacks after afterDestroy", async () => {
    const user = await users().create({ email: "a@example.com" });
    log.length = 0;

    await user.destroy();

    expect(log).toEqual([
      "DELETE",
      "afterDestroy a@example.com",
      "afterCommit a@example.com",
      "afterDestroyCommit a@example.com",
    ]);
  });

  test("destroying a record that was never saved runs no commit callback: there was no row", async () => {
    await users().build({ email: "a@example.com" }).destroy();

    expect(log).toEqual(["afterDestroy a@example.com"]);
  });

  test("in a batch, the commit callbacks run after every record's after-callbacks", async () => {
    const database = harness.connect();
    const first = database.model(User).build({ email: "a@example.com" });
    const second = database.model(User).build({ email: "b@example.com" });

    await database.batch((b) => [b.save(first), b.save(second)]);

    expect(log).toEqual([
      "afterSave a@example.com",
      "afterSave b@example.com",
      "afterCommit a@example.com",
      "afterCreateCommit a@example.com",
      "afterSaveCommit a@example.com",
      "afterCommit b@example.com",
      "afterCreateCommit b@example.com",
      "afterSaveCommit b@example.com",
    ]);
  });

  test("an error thrown in a commit callback reaches the caller, and the write is kept", async () => {
    const failure = new Error("mailer is down");
    hooks.afterCommit = () => {
      throw failure;
    };
    const user = users().build({ email: "a@example.com" });

    await expect(user.save()).rejects.toBe(failure);

    expect(user.isPersisted()).toBe(true);
    expect(await users().pluck("email")).toEqual(["a@example.com"]);
    expect(log).not.toContain("afterCreateCommit a@example.com");
  });

  test("abort() in a commit callback throws AbortAfterPersistence: the write is already kept", async () => {
    hooks.afterCommit = () => {
      throw abort("too late");
    };

    const error: unknown = await users()
      .create({ email: "a@example.com" })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(AbortAfterPersistence);
    expect((error as AbortAfterPersistence).callback).toBe("afterCommit");
    expect(await users().count()).toBe(1);
  });

  test("in a batch, an error in one record's commit callback skips the callbacks after it; every write is kept", async () => {
    const failure = new Error("mailer is down");
    hooks.afterCommit = (user) => {
      if (user.email === "a@example.com") throw failure;
    };
    const database = harness.connect();
    const first = database.model(User).build({ email: "a@example.com" });
    const second = database.model(User).build({ email: "b@example.com" });

    await expect(database.batch((b) => [b.save(first), b.save(second)])).rejects.toBe(failure);

    expect(log).toEqual([
      "afterSave a@example.com",
      "afterSave b@example.com",
      "afterCommit a@example.com",
    ]);
    expect(await users().count()).toBe(2);
  });

  test("an error in an after-callback skips the commit callbacks, though the write is kept", async () => {
    const failure = new Error("cache is down");
    hooks.afterSave = () => {
      throw failure;
    };

    await expect(users().create({ email: "a@example.com" })).rejects.toBe(failure);

    expect(log).toEqual(["INSERT", "afterSave a@example.com"]);
    expect(await users().count()).toBe(1);
  });
});
