import { afterAll, beforeAll, expect, test } from "vite-plus/test";
import { belongsTo, Model } from "../../../packages/active-record/src/index.ts";
import { connect } from "../../../packages/active-record/src/adapters/d1/index.ts";
import { createTestDatabase, type TestDatabase } from "../../support/d1.ts";

// SQLite reads a table's name in any case, so "USERS" is the users table joined a second time.
class Member extends Model.define({ id: { type: "integer", null: false } }) {
  static table = "users";
}

class ShoutedMember extends Model.define({ id: { type: "integer", null: false } }) {
  static table = "USERS";
}

class Entry extends Model.define({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
}) {
  static table = "posts";

  member = belongsTo(Member, { foreignKey: "userId" });
  shouted = belongsTo(ShoutedMember, { foreignKey: "userId" });
}

let binding: TestDatabase;
let dispose: () => Promise<void>;

beforeAll(async () => {
  ({ db: binding, dispose } = await createTestDatabase());
  await binding.batch([
    binding.prepare("INSERT INTO users (id, email) VALUES (1, 'a@example.com')"),
    binding.prepare("INSERT INTO posts (id, user_id, title) VALUES (10, 1, 'A1')"),
  ]);
});
afterAll(() => dispose());

test("a table named again in another case is joined under an alias (#24)", async () => {
  const entries = await connect(binding).model(Entry).joins("member", "shouted").toArray();

  expect(entries.map((entry) => entry.id)).toEqual([10]);
});
