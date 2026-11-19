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
});
