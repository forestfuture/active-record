import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { Model } from "../../packages/active-record/src/index.ts";
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
});
