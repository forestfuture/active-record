import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import {
  abort,
  hasMany,
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
    this.beforeDestroy(() => void log.push("beforeDestroy"));
    this.aroundDestroy(logged("aroundDestroy"));
    this.afterDestroy(() => void log.push("afterDestroy"));
  }
}

class AdminAccount extends Account {
  static {
    this.aroundSave(logged("admin aroundSave"));
  }
}

/** What Gated's aroundSave and aroundDestroy do in place of `await next()`, set per test. */
let aroundSave: (next: () => Promise<void>) => Promise<void>;
let aroundDestroy: (next: () => Promise<void>) => Promise<void>;

class Gated extends Model.define({
  id: { type: "integer", null: false },
  email: "string",
  updatedAt: "datetime",
}) {
  static table = "users";

  static {
    this.aroundSave((_gated, next) => aroundSave(next));
    this.aroundDestroy((_gated, next) => aroundDestroy(next));
    this.afterSave(() => void log.push("afterSave"));
    this.afterRollback(() => void log.push("afterRollback"));
  }
}

class Refusing extends Model.define({
  id: { type: "integer", null: false },
  email: "string",
}) {
  static table = "users";

  static {
    this.beforeSave(() => {
      throw abort("Refused");
    });
  }
}

class Exploding extends Model.define({
  id: { type: "integer", null: false },
  email: "string",
}) {
  static table = "users";

  static {
    this.afterSave(() => {
      throw new Error("Exploded");
    });
  }
}

class RefusedPost extends Model.define({
  id: { type: "integer", null: false },
  userId: "integer",
  title: "string",
}) {
  static table = "posts";

  static {
    this.beforeSave(() => {
      throw abort("Refused post");
    });
  }
}

class Author extends Gated {
  posts = hasMany(RefusedPost, { foreignKey: "userId" });
}

class LoggedPost extends Model.define({
  id: { type: "integer", null: false },
  userId: "integer",
  title: "string",
}) {
  static table = "posts";

  static {
    this.afterSave((post) => void log.push(`post afterSave ${post.title}`));
  }
}

class Writer extends Gated {
  posts = hasMany(LoggedPost, { foreignKey: "userId" });
}

/** An aroundSave that logs how `next()` settled. */
const reporting = async (next: () => Promise<void>) => {
  try {
    await next();
    log.push("next() resolved");
  } catch (error) {
    log.push(`next() rejected: ${(error as Error).name}: ${(error as Error).message}`);
    throw error;
  }
};

/** What Nested's second aroundSave does in place of `await next()`, set per test. */
let innerAroundSave: (next: () => Promise<void>) => Promise<void>;

class Nested extends Model.define({
  id: { type: "integer", null: false },
  email: "string",
}) {
  static table = "users";

  static {
    this.aroundSave((_nested, next) => reporting(next));
    this.aroundSave((_nested, next) => innerAroundSave(next));
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
    await harness.reset("posts", "users");
    log.length = 0;
    aroundSave = (next) => next();
    aroundDestroy = (next) => next();
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

  test("a clean save runs aroundSave and aroundUpdate, with nothing sent", async () => {
    const accounts = harness
      .connect({ onQuery: (event) => log.push(event.sql.split(" ")[0] ?? "") })
      .model(Account);
    const account = await accounts.create({ id: 1, email: "a@example.com" });
    log.length = 0;

    await account.saveOrThrow();

    expect(log).toEqual([
      "aroundSave 1 first",
      "aroundSave 2 first",
      "aroundUpdate first",
      "aroundUpdate last",
      "aroundSave 2 last",
      "aroundSave 1 last",
    ]);
  });

  test("aroundDestroy wraps the DELETE, between beforeDestroy and afterDestroy", async () => {
    const accounts = harness
      .connect({ onQuery: (event) => log.push(event.sql.split(" ")[0] ?? "") })
      .model(Account);
    const account = await accounts.create({ id: 1, email: "a@example.com" });
    log.length = 0;

    await account.destroyOrThrow();

    expect(log).toEqual([
      "beforeDestroy",
      "aroundDestroy first",
      "DELETE",
      "aroundDestroy last",
      "afterDestroy",
    ]);
  });

  test("destroying a never-saved record runs aroundDestroy, with nothing sent", async () => {
    const account = harness.connect().model(Account).build({ id: 1 });

    await account.destroyOrThrow();

    expect(log).toEqual([
      "beforeDestroy",
      "aroundDestroy first",
      "aroundDestroy last",
      "afterDestroy",
    ]);
  });

  test("in a batch, every record's first part runs before the one write", async () => {
    const db = harness.connect({ onQuery: (event) => log.push(event.sql.split(" ")[0] ?? "") });
    const first = db.model(Member).build({ id: 1, email: "a@example.com" });
    const second = db.model(Member).build({ id: 2, email: "b@example.com" });

    await db.batch((b) => [b.save(first), b.save(second)]);

    expect(log.filter((line) => !line.startsWith("before"))).toEqual([
      "aroundSave first",
      "aroundSave first",
      "INSERT",
      "INSERT",
      "afterCreate",
      "aroundSave last",
      "afterSave",
      "afterCreate",
      "aroundSave last",
      "afterSave",
      "afterCommit",
      "afterCommit",
    ]);
  });

  // Guards: these pass since the slices that built them.
  test("an owner's aroundSave finishes before its autosaved records' after-callbacks", async () => {
    aroundSave = reporting;
    const writer = harness.connect().model(Writer).build({ id: 1, email: "a@example.com" });
    writer.posts().build({ id: 10, title: "First" });

    await writer.saveOrThrow();

    expect(log).toEqual(["next() resolved", "afterSave", "post afterSave First"]);
  });

  test("touch() runs no around callback", async () => {
    const gated = await harness.connect().model(Gated).create({ id: 1, email: "a@example.com" });
    log.length = 0;
    aroundSave = reporting;

    await gated.touch();

    expect(log).toEqual([]);
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

    test("an inner aroundSave that doesn't call next() rejects the outer one's next()", async () => {
      innerAroundSave = async () => {};
      const record = harness.connect().model(Nested).build({ id: 1, email: "a@example.com" });

      expect(await record.save()).toBe(false);
      expect(log).toEqual([
        "next() rejected: CallbackAbort: An aroundSave callback didn't call next()",
      ]);
      expect(await rows()).toBe(0);
    });

    test("an aroundDestroy that doesn't call next() stops the destroy", async () => {
      const record = await gated().create({ id: 1, email: "a@example.com" });
      aroundDestroy = async () => {};

      expect(await record.destroy()).toBe(false);
      expect(record.abortReason).toBe("An aroundDestroy callback didn't call next()");
      expect(record.isDestroyed()).toBe(false);
      expect(await rows()).toBe(1);
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

  describe("a write that's never sent", () => {
    test("rejects next() with the batch's error when a later record refuses", async () => {
      aroundSave = reporting;
      const db = harness.connect();
      const waiting = db.model(Gated).build({ id: 1, email: "a@example.com" });
      const refusing = db.model(Refusing).build({ id: 2, email: "b@example.com" });

      await expect(db.batch((b) => [b.save(waiting), b.save(refusing)])).rejects.toThrow(
        new RecordNotSaved("Refused"),
      );
      expect(log).toEqual(["next() rejected: RecordNotSaved: Refused"]);
    });

    test("rejects next() with the error saveOrThrow would throw when an autosaved record refuses", async () => {
      aroundSave = reporting;
      const author = harness.connect().model(Author).build({ id: 1, email: "a@example.com" });
      author.posts().build({ id: 10, title: "First" });

      expect(await author.save()).toBe(false);
      expect(log).toEqual(["next() rejected: RecordNotSaved: Refused post"]);
    });

    test("rejects next() with the error that skipped its after-callbacks", async () => {
      aroundSave = reporting;
      const db = harness.connect();
      const exploding = db.model(Exploding).build({ id: 1, email: "a@example.com" });
      const waiting = db.model(Gated).build({ id: 2, email: "b@example.com" });

      await expect(db.batch((b) => [b.save(exploding), b.save(waiting)])).rejects.toThrow(
        "Exploded",
      );
      expect(log).toEqual(["next() rejected: Error: Exploded"]);
    });
  });
});
