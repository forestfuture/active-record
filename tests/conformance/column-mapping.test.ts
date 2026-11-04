import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { Model } from "../../src/index.ts";
import { openHarness, type Harness } from "../support/harness.ts";

class Account extends Model.define({
  id: { type: "integer", null: false },
  isActive: "boolean",
  externalAccountId: "string",
  htmlURL: "string",
  userID: "integer",
  sha256Hash: "string",
  legacyId: { type: "string", column: "person_identifier" },
}) {
  static table = "accounts";
}

describe("column mapping", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.exec("DELETE FROM accounts");
    await harness.exec(`INSERT INTO accounts (id, is_active, external_account_id, html_url, user_id, sha256_hash, person_identifier)
         VALUES (1, 1, 'ext-1', 'https://example.com', 7, 'abc', 'P-1'),
                (2, 0, 'ext-2', NULL, NULL, NULL, 'P-2')`);
  });

  test("camelCase attributes read from their snake_case columns", async () => {
    const accounts = await harness.connect().model(Account).where({ id: 1 }).toArray();

    expect(accounts[0]?.attributes()).toEqual({
      id: 1,
      isActive: true,
      externalAccountId: "ext-1",
      htmlURL: "https://example.com",
      userID: 7,
      sha256Hash: "abc",
      legacyId: "P-1",
    });
  });

  test("where uses the mapped column, including an explicit override", async () => {
    const accounts = harness.connect().model(Account);

    const active = await accounts.where({ isActive: false }).toArray();
    const legacy = await accounts.where({ legacyId: "P-2" }).toArray();

    expect(active.map((account) => account.id)).toEqual([2]);
    expect(legacy.map((account) => account.id)).toEqual([2]);
  });

  test("where maps acronym attributes to their columns", async () => {
    const accounts = harness.connect().model(Account);

    const byUrl = await accounts.where({ htmlURL: "https://example.com" }).toArray();
    const byUser = await accounts.where({ userID: 7, sha256Hash: "abc" }).toArray();

    expect(byUrl.map((account) => account.id)).toEqual([1]);
    expect(byUser.map((account) => account.id)).toEqual([1]);
  });
});
