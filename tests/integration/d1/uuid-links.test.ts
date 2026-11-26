import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { hasMany, Model } from "../../../packages/arbor/src/index.ts";
import { connect } from "../../../packages/arbor/src/adapters/d1/index.ts";
import { createTestDatabase, type TestDatabase } from "../../support/d1.ts";

const phoneId = "0b6f8a1e-3c2d-4e5f-9a7b-1c2d3e4f5a6b";

// A text key pointed at by a uuid foreign key: D1 only, since Postgres can't link a string
// attribute over a UUID column to a uuid one.
class Phone extends Model.define({ id: { type: "string", null: false } }) {
  static table = "phones";

  calls = hasMany(Call, { foreignKey: "phoneId" });
}

class Call extends Model.define({
  id: { type: "integer", null: false },
  phoneId: "uuid",
}) {
  static table = "calls";
}

// A text key in another form than a uuid's one finds none of its records (#588), read or
// preloaded alike.
describe("a text key linked to a uuid foreign key", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;
  const db = () => connect(binding);

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
    await binding.batch([
      binding.prepare("CREATE TABLE phones (id TEXT PRIMARY KEY NOT NULL)"),
      binding.prepare("CREATE TABLE calls (id INTEGER PRIMARY KEY, phone_id TEXT)"),
    ]);
  });
  afterAll(() => dispose());
  beforeEach(async () => {
    await binding.batch([
      binding.prepare("DELETE FROM phones"),
      binding.prepare("DELETE FROM calls"),
      binding.prepare("INSERT INTO calls (id, phone_id) VALUES (1, ?)").bind(phoneId),
    ]);
  });

  const otherForms = [
    ["capitals", phoneId.toUpperCase()],
    ["braces", `{${phoneId}}`],
    ["no hyphens", phoneId.replaceAll("-", "")],
  ];

  test.each(otherForms)("in %s, a hasMany reads none of its records", async (_, id) => {
    const phone = await db().model(Phone).create({ id });

    expect(await phone.calls().pluck("id")).toEqual([]);
  });

  test.each(otherForms)("in %s, a hasMany preloads none of its records", async (_, id) => {
    await db().model(Phone).create({ id });

    const [phone] = await db().model(Phone).includes("calls").toArray();

    expect(phone!.loaded("calls")).toEqual([]);
  });

  test.each(otherForms)(
    "in %s, a record built through a hasMany takes the key in its one form",
    async (_, id) => {
      const phone = await db().model(Phone).create({ id });

      expect(phone.calls().build({ id: 2 }).phoneId).toBe(phoneId);
    },
  );

  test("in its one form, a hasMany reads and preloads its records", async () => {
    const phone = await db().model(Phone).create({ id: phoneId });
    const [preloaded] = await db().model(Phone).includes("calls").toArray();

    expect([
      await phone.calls().pluck("id"),
      preloaded!.loaded("calls").map(({ id }) => id),
    ]).toEqual([[1], [1]]);
  });
});
