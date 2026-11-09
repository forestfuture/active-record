import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { Model, NoDatabase, withDatabase } from "../../../packages/active-record/src/index.ts";
import {
  connect,
  postgresql,
} from "../../../packages/active-record/src/adapters/postgresql/index.ts";
import { openPgSchema, type PgSchema } from "../../support/pg.ts";

abstract class PgRecord extends Model {
  static override schema = { adapter: postgresql({ binding: "DATABASE_URL" }), tables: {} };
}

class User extends PgRecord.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
}) {
  static override table = "users";
}

// Outside a Worker there's no binding to read (#269): statics use the request's database.
describe("a Model's statics on Node", () => {
  let schema: PgSchema;

  beforeAll(async () => {
    schema = await openPgSchema();
  });
  afterAll(() => schema.dispose());

  test("outside withDatabase, throw NoDatabase saying the binding is a Worker's", async () => {
    await expect(User.first()).rejects.toThrow(
      new NoDatabase(
        "No database for this query: the binding DATABASE_URL is only there inside a Worker. " +
          "Wrap the code in withDatabase(connect(…), …), or use db.model(Model)",
      ),
    );
  });

  test("inside withDatabase, use the request's database", async () => {
    const email = await withDatabase(connect(schema.url), async () => {
      const made = await User.create({ email: "node@example.com" });
      return (await User.find(made.id)).email;
    });

    expect(email).toBe("node@example.com");
  });
});
