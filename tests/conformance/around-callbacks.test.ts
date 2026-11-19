import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  abort,
  AbortAfterPersistence,
  Model,
  RecordNotSaved,
  RecordNotUnique,
} from "../../packages/active-record/src/index.ts";
import { openHarness, type Harness } from "../support/harness.ts";

const log: string[] = [];

class Member extends Model.define({
  id: { type: "integer", null: false },
  email: "string",
}) {
  static table = "users";

  static {
    this.beforeSave(() => void log.push("beforeSave"));
    this.beforeCreate(() => void log.push("beforeCreate"));
    this.beforeUpdate(() => void log.push("beforeUpdate"));
    this.aroundSave(async (_member, next) => {
      log.push("aroundSave first");
      await next();
      log.push("aroundSave last");
    });
    this.afterCreate(() => void log.push("afterCreate"));
    this.afterUpdate(() => void log.push("afterUpdate"));
    this.afterSave(() => void log.push("afterSave"));
    this.afterCommit(() => void log.push("afterCommit"));
  }
}

/** Logs `name first` before `next()` and `name last` after it. */
const logged = (name: string) => async (_record: unknown, next: () => Promise<void>) => {
  log.push(`${name} first`);
  await next();
  log.push(`${name} last`);
};

class Account extends Model.define({
  id: { type: "integer", null: false },
  email: "string",
}) {
  static table = "users";

  static {
    this.aroundSave(logged("aroundSave 1"));
    this.aroundCreate(logged("aroundCreate 1"));
    this.aroundUpdate(logged("aroundUpdate"));
    this.aroundSave(logged("aroundSave 2"));
    this.aroundCreate(logged("aroundCreate 2"));
    this.afterCreate(() => void log.push("afterCreate"));
  }
}

class AdminAccount extends Account {
  static {
    this.aroundSave(logged("admin aroundSave"));
  }
}

/** What Gated's aroundSave does in place of `await next()`, set per test. */
let aroundSave: (next: () => Promise<void>) => Promise<void>;

class Gated extends Model.define({
  id: { type: "integer", null: false },
  email: "string",
}) {
  static table = "users";

  static {
    this.aroundSave((_gated, next) => aroundSave(next));
    this.afterSave(() => void log.push("afterSave"));
    this.afterRollback(() => void log.push("afterRollback"));
  }
}

describe("around callbacks", () => {
  let harness: Harness;
  const members = () =>
    harness.connect({ onQuery: (event) => log.push(event.sql.split(" ")[0] ?? "") }).model(Member);

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.reset("users");
    log.length = 0;
    aroundSave = (next) => next();
  });

  test("aroundSave wraps a create: beforeCreate, the INSERT and afterCreate run inside it", async () => {
    await members().create({ id: 1, email: "a@example.com" });

    expect(log).toEqual([
      "beforeSave",
      "aroundSave first",
      "beforeCreate",
      "INSERT",
      "afterCreate",
      "aroundSave last",
      "afterSave",
      "afterCommit",
    ]);
  });

  test("aroundSave wraps an update the same way", async () => {
    const member = await members().create({ id: 1, email: "a@example.com" });
    log.length = 0;

    await member.update({ email: "b@example.com" });

    expect(log).toEqual([
      "beforeSave",
      "aroundSave first",
      "beforeUpdate",
      "UPDATE",
      "afterUpdate",
      "aroundSave last",
      "afterSave",
      "afterCommit",
    ]);
  });

  test("aroundCreate wraps the INSERT inside aroundSave, the first declared outermost", async () => {
    await harness
      .connect({ onQuery: (event) => log.push(event.sql.split(" ")[0] ?? "") })
      .model(Account)
      .create({ id: 1, email: "a@example.com" });

    expect(log).toEqual([
      "aroundSave 1 first",
      "aroundSave 2 first",
      "aroundCreate 1 first",
      "aroundCreate 2 first",
      "INSERT",
      "aroundCreate 2 last",
      "aroundCreate 1 last",
      "afterCreate",
      "aroundSave 2 last",
      "aroundSave 1 last",
    ]);
  });

  test("aroundUpdate wraps the UPDATE, and a subclass's run inside its parent's", async () => {
    const accounts = harness
      .connect({ onQuery: (event) => log.push(event.sql.split(" ")[0] ?? "") })
      .model(AdminAccount);
    const account = await accounts.create({ id: 1, email: "a@example.com" });
    log.length = 0;

    await account.update({ email: "b@example.com" });

    expect(log).toEqual([
      "aroundSave 1 first",
      "aroundSave 2 first",
      "admin aroundSave first",
      "aroundUpdate first",
      "UPDATE",
      "aroundUpdate last",
      "admin aroundSave last",
      "aroundSave 2 last",
      "aroundSave 1 last",
    ]);
  });

  describe("stopping a save", () => {
    const gated = () => harness.connect().model(Gated);
    const rows = async () => harness.connect().model(Gated).count();

    test("an aroundSave that doesn't call next() stops the save, as abort() does", async () => {
      aroundSave = async () => {};
      const record = gated().build({ id: 1, email: "a@example.com" });

      expect(await record.save()).toBe(false);
      expect(record.abortReason).toBe("An aroundSave callback didn't call next()");
      await expect(record.saveOrThrow()).rejects.toThrow(
        new RecordNotSaved("An aroundSave callback didn't call next()"),
      );
      expect(record.isNewRecord()).toBe(true);
      expect(log).toEqual([]);
      expect(await rows()).toBe(0);
    });

    test("an abort() before next() stops the save", async () => {
      aroundSave = async () => {
        throw abort("Not yet");
      };
      const record = gated().build({ id: 1, email: "a@example.com" });

      expect(await record.save()).toBe(false);
      expect(record.abortReason).toBe("Not yet");
      expect(await rows()).toBe(0);
    });

    test("an abort() after next() is AbortAfterPersistence, with the row kept", async () => {
      aroundSave = async (next) => {
        await next();
        throw abort("Too late");
      };

      const saving = gated().create({ id: 1, email: "a@example.com" });

      await expect(saving).rejects.toThrow(AbortAfterPersistence);
      await expect(saving).rejects.toMatchObject({ callback: "aroundSave", reason: "Too late" });
      expect(log).toEqual([]);
      expect(await rows()).toBe(1);
    });

    test("calling next() a second time rejects with TypeError, with the row kept", async () => {
      aroundSave = async (next) => {
        await next();
        await next();
      };

      await expect(gated().create({ id: 1, email: "a@example.com" })).rejects.toThrow(
        new TypeError("aroundSave: next() was already called"),
      );
      expect(await rows()).toBe(1);
    });
  });

  describe("a write the database refuses", () => {
    beforeEach(() => harness.exec("INSERT INTO users (id, email) VALUES (1, 'taken@example.com')"));
    const duplicate = () =>
      harness.connect().model(Gated).create({ id: 1, email: "a@example.com" });

    test("rejects next() after afterRollback, and the save throws the refusal even if it's caught", async () => {
      aroundSave = async (next) => {
        try {
          await next();
        } catch (error) {
          log.push(`next() rejected: ${(error as Error).name}`);
        }
      };

      await expect(duplicate()).rejects.toThrow(RecordNotUnique);
      expect(log).toEqual(["afterRollback", "next() rejected: RecordNotUnique"]);
    });

    test("an error the around callback throws instead reaches the caller, the refusal its cause", async () => {
      const replaced = new Error("Couldn't save");
      aroundSave = async (next) => {
        await next().catch(() => {
          throw replaced;
        });
      };

      const saving = duplicate();

      await expect(saving).rejects.toBe(replaced);
      expect(replaced.cause).toBeInstanceOf(RecordNotUnique);
    });
  });
});
