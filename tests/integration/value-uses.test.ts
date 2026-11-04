import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { belongsTo, hasMany, hasOne, Model } from "../../packages/active-record/src/index.ts";
import { connect } from "../../packages/d1-record/src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

// A text foreign key (label) pointing at an integer key: the two keys' types differ.
class Note extends Model.define({ id: { type: "integer", null: false }, label: "string" }) {
  static table = "samples";

  owner = belongsTo(Owner, { foreignKey: "label" });
}

class Owner extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
}) {
  static table = "users";

  notes = hasMany(Note, { foreignKey: "label" });
  note = hasOne(Note, { foreignKey: "label" });
}

// An integer foreign key (quantity) pointing at a text key.
class Code extends Model.define({ id: { type: "string", null: false }, label: "string" }) {
  static table = "api_keys";

  counted = hasMany(Counted, { foreignKey: "quantity" });
}

class Counted extends Model.define({ id: { type: "integer", null: false }, quantity: "integer" }) {
  static table = "samples";

  code = belongsTo(Code, { foreignKey: "quantity" });
}

// Values a record inherits from a condition, and keys copied from another record, are cast as
// the condition or key they came from, not as values a request assigns (#94).
describe("values by their use", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;
  const db = () => connect(binding);

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
  });
  afterAll(() => dispose());
  beforeEach(async () => {
    await binding.batch([
      binding.prepare("DELETE FROM samples"),
      binding.prepare("DELETE FROM users"),
      binding.prepare("DELETE FROM api_keys"),
    ]);
  });

  describe("preloading across key types", () => {
    // Compared by number, a text column's index can't be searched: the integer key is selected
    // as text instead, so D1 reads (and bills) the matches, not the whole table.
    describe("an integer key searches a text key's index", () => {
      const labels = Array.from({ length: 10 }, (_, index) => String(index + 1));
      const read: Record<string, number> = {};
      const counting = () =>
        connect(binding, { onQuery: ({ model, meta }) => (read[model] = meta?.rows_read ?? 0) });

      test("for a hasMany", async () => {
        await binding.exec("CREATE INDEX IF NOT EXISTS samples_label ON samples (label)");
        await db().model(Owner).insert({ id: 9, email: "ada@example.com" });
        await db()
          .model(Note)
          .insertAll(labels.map((label, index) => ({ id: index + 1, label })));

        await counting().model(Owner).includes("notes").toArray();

        expect(read["Note"]).toBeLessThan(labels.length);
      });

      test("for a belongsTo", async () => {
        await db()
          .model(Code)
          .insertAll(labels.map((id) => ({ id, label: id })));
        await db().model(Counted).insert({ id: 20, quantity: 9 });

        await counting().model(Counted).where({ id: 20 }).includes("code").toArray();

        expect(read["Code"]).toBeLessThan(labels.length);
      });
    });
  });
});
