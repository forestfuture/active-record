import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { belongsTo, hasMany, Model } from "../../../packages/arbor/src/index.ts";
import { connect, type QueryEvent } from "../../../packages/arbor/src/adapters/d1/index.ts";
import { createTestDatabase, recordingBatches, type TestDatabase } from "../../support/d1.ts";

class User extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
}) {
  static table = "users";

  linkedAccounts = hasMany(Account, { foreignKey: "externalAccountId" });
}

// external_account_id is text holding a user's id: a mixed-type link to the integer key.
class Account extends Model.define({
  id: { type: "integer", null: false },
  userId: "integer",
  externalAccountId: "string",
}) {
  static table = "accounts";

  owner = belongsTo(User, { foreignKey: "userId", optional: true });
  linkedUser = belongsTo(User, { foreignKey: "externalAccountId", optional: true });
}

// A level over a mixed-type link is preloaded by its owners' loaded keys, after they're loaded
// (#596), rather than with a subquery in their round trip: a later round trip on D1.
describe("preloading over a mixed-type link", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;
  let recording: ReturnType<typeof recordingBatches>;
  const queries: QueryEvent[] = [];
  const db = () => connect(recording.binding, { onQuery: (event) => queries.push(event) });

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
  });
  afterAll(() => dispose());
  beforeEach(async () => {
    recording = recordingBatches(binding);
    queries.length = 0;
    await binding.batch([
      binding.prepare("DELETE FROM accounts"),
      binding.prepare("DELETE FROM users"),
      binding.prepare(
        "INSERT INTO users (id, email) VALUES (1, 'a@example.com'), (2, 'b@example.com')",
      ),
      binding.prepare(
        "INSERT INTO accounts (id, user_id, external_account_id) VALUES (1, 1, '2'), (2, 2, '1'), (3, NULL, '09')",
      ),
    ]);
  });

  test("a mixed-type belongsTo is preloaded once its owners are loaded", async () => {
    const accounts = await db()
      .model(Account)
      .includes("linkedUser")
      .order({ id: "asc" })
      .toArray();

    const emails = accounts.map((account) => account.loaded("linkedUser")?.email ?? null);
    expect(emails).toEqual(["b@example.com", "a@example.com", null]);
    expect(recording.batches).toEqual([]);
    expect(queries).toHaveLength(2);
  });

  test("a same-type sibling still goes in the owners' round trip", async () => {
    const accounts = await db()
      .model(Account)
      .includes("owner", "linkedUser")
      .order({ id: "asc" })
      .toArray();

    expect(accounts.map((account) => account.loaded("owner")?.id ?? null)).toEqual([1, 2, null]);
    expect(accounts.map((account) => account.loaded("linkedUser")?.id ?? null)).toEqual([
      2,
      1,
      null,
    ]);
    expect(recording.batches).toEqual([2]);
    expect(queries).toHaveLength(3);
  });

  test("the levels under a mixed-type level go in its round trip", async () => {
    const users = await db()
      .model(User)
      .includes({ linkedAccounts: "owner" })
      .order({ id: "asc" })
      .toArray();

    const owners = users.map((user) =>
      user.loaded("linkedAccounts").map((account) => account.loaded("owner")?.id ?? null),
    );
    expect(owners).toEqual([[2], [1]]);
    expect(recording.batches).toEqual([2]);
    expect(queries).toHaveLength(3);
  });
});
