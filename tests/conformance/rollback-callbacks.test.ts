import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { abort, Model, RecordNotUnique } from "../../packages/active-record/src/index.ts";
import { openHarness, type Harness } from "../support/harness.ts";

const log: string[] = [];

class User extends Model.define({
  id: { type: "integer", null: false },
  email: "string",
  role: "string",
}) {
  static table = "users";

  static {
    this.validates("email", { presence: true });
    this.beforeSave((user) => {
      if (user.role === "blocked") throw abort("blocked users can't be saved");
    });
    this.afterSave((user) => void log.push(`afterSave ${user.email}`));
    this.afterCommit((user) => void log.push(`afterCommit ${user.email}`));
    this.afterRollback((user) => {
      log.push(`afterRollback ${user.email} (new: ${user.isNewRecord()})`);
    });
  }
}

describe("rollback callbacks", () => {
  let harness: Harness;
  const db = () => harness.connect();

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.reset("users");
    await harness.exec("INSERT INTO users (id, email) VALUES (1, 'taken@example.com')");
    log.length = 0;
  });

  test("a save the database refuses runs afterRollback, and no after- or commit callback", async () => {
    const user = db().model(User).build({ email: "taken@example.com" });

    await expect(user.save()).rejects.toThrow(RecordNotUnique);

    expect(log).toEqual(["afterRollback taken@example.com (new: true)"]);
  });

  test("a batch the database refuses runs afterRollback for each record in it, and no after-callback", async () => {
    const database = db();
    const fresh = database.model(User).build({ email: "b@example.com" });
    const existing = await database.model(User).find(1);
    existing.role = "admin";

    await expect(
      database.batch((b) => [
        b.save(fresh),
        b.save(existing),
        b.insert(User, { id: 2, email: "taken@example.com" }),
      ]),
    ).rejects.toThrow(RecordNotUnique);

    expect(log).toEqual([
      "afterRollback b@example.com (new: true)",
      "afterRollback taken@example.com (new: false)",
    ]);
  });

  test("a destroy in a refused batch runs afterRollback, and the record isn't destroyed", async () => {
    const database = db();
    const existing = await database.model(User).find(1);

    await expect(
      database.batch((b) => [
        b.destroy(existing),
        b.insert(User, { id: 2, email: "b@example.com" }),
        b.insert(User, { id: 3, email: "b@example.com" }),
      ]),
    ).rejects.toThrow(RecordNotUnique);

    expect(log).toEqual(["afterRollback taken@example.com (new: false)"]);
    expect(existing.isDestroyed()).toBe(false);
  });

  test("a save refused before anything is sent runs no afterRollback: an invalid record, or an abort()", async () => {
    const database = db();

    expect(await database.model(User).build({ email: "" }).save()).toBe(false);
    expect(
      await database.model(User).build({ email: "c@example.com", role: "blocked" }).save(),
    ).toBe(false);

    expect(log).toEqual([]);
  });
});
