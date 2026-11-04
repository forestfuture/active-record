import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { MissingAttribute, Model } from "../../packages/active-record/src/index.ts";
import type { QueryEvent } from "../../packages/active-record/src/executor.ts";
import { openHarness, type Harness } from "../support/harness.ts";

// The accounts table has no UNIQUE constraints, so only the validation can reject duplicates.
class Account extends Model.define({
  id: { type: "integer", null: false },
  externalAccountId: "string",
  userID: "integer",
  htmlURL: "string",
}) {
  static table = "accounts";

  static {
    this.validates("externalAccountId", { uniqueness: { scope: ["userID"] } });
    this.validates("htmlURL", { uniqueness: { caseSensitive: false } });
  }
}

describe("uniqueness validation", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.exec("DELETE FROM accounts");
  });

  test("a value another row already has is taken, within the scope", async () => {
    const accounts = harness.connect().model(Account);
    await accounts.create({ externalAccountId: "e1", userID: 1 });

    const sameUser = accounts.build({ externalAccountId: "e1", userID: 1 });
    const otherUser = accounts.build({ externalAccountId: "e1", userID: 2 });

    expect(await sameUser.isValid()).toBe(false);
    expect(sameUser.errors.toArray()).toEqual([
      { attribute: "externalAccountId", type: "taken", message: "has already been taken" },
    ]);
    expect(await otherUser.isValid()).toBe(true);
  });

  test("a saved record doesn't count as a duplicate of itself", async () => {
    const account = await harness
      .connect()
      .model(Account)
      .create({ externalAccountId: "e1", userID: 1 });

    account.htmlURL = "https://example.com";

    expect(await account.save()).toBe(true);
  });

  test("null is never taken, as a UNIQUE index treats it", async () => {
    const accounts = harness.connect().model(Account);
    await accounts.create({ externalAccountId: "e1", userID: 1 });

    expect(await accounts.build({ externalAccountId: "e2", userID: 1 }).isValid()).toBe(true);
  });

  test("caseSensitive: false compares lowercased values", async () => {
    const accounts = harness.connect().model(Account);
    await accounts.create({ externalAccountId: "e1", htmlURL: "https://Example.com" });

    const shouted = accounts.build({ externalAccountId: "e2", htmlURL: "HTTPS://EXAMPLE.COM" });

    expect(await shouted.isValid()).toBe(false);
    expect(shouted.errors.get("htmlURL")).toEqual(["has already been taken"]);
  });

  test("the check runs through the record's own Database", async () => {
    const queries: QueryEvent[] = [];
    const accounts = harness.connect({ onQuery: (event) => queries.push(event) }).model(Account);

    await accounts.build({ externalAccountId: "e1" }).isValid();

    expect(queries.map((query) => query.sql)).toEqual([
      expect.stringMatching(/^SELECT 1 FROM "accounts"/),
    ]);
  });

  test("a keyless record can't be checked for uniqueness: it can't leave itself out", async () => {
    const accounts = harness.connect().model(Account);
    await accounts.create({ externalAccountId: "e1", userID: 1 });
    // Every validated attribute is loaded, so only the uniqueness check can fail.
    const [keyless] = await accounts
      .select("externalAccountId", "userID", "htmlURL")
      .distinct()
      .toArray();
    if (!keyless) throw new Error("expected a record");

    await expect(keyless.isValid()).rejects.toThrow(MissingAttribute);
    await expect(keyless.isValid()).rejects.toThrow(/primary key/);
  });
});
