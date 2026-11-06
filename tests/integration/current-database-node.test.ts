import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { Model, NoDatabase, withDatabase } from "../../packages/active-record/src/index.ts";
import { d1, connect } from "../../packages/d1-record/src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

// Outside a Worker, as tests and scripts run: cloudflare:workers doesn't exist here.
/** An app's base class for the DB binding: its generated schema names the binding. */
abstract class DbRecord extends Model {
  static override schema = { adapter: d1({ binding: "DB" }), tables: {}, models: {} };
}

class User extends DbRecord.define({ id: { type: "integer", null: false }, email: "string" }) {
  static table = "users";
}

let binding: TestDatabase;
let dispose: () => Promise<void>;
beforeAll(async () => ({ db: binding, dispose } = await createTestDatabase()));
afterAll(() => dispose());

describe("outside a Worker", () => {
  test("a binding is only there inside a Worker, so a query says to give it a database", async () => {
    await expect(User.count()).rejects.toThrow(
      new NoDatabase(
        "No database for this query: the binding DB is only there inside a Worker. Wrap the code in withDatabase(connect(env.DB), …), or use db.model(Model)",
      ),
    );
  });

  test("withDatabase serves every Model; several can't be told apart, so that's an error", async () => {
    expect(await withDatabase(connect(binding), () => User.count())).toBe(0);
    await expect(
      withDatabase([connect(binding), connect(binding)], () => User.count()),
    ).rejects.toThrow(
      "No database for this query: withDatabase was given several, and outside a Worker a binding can't tell which",
    );
  });

  test("a Database given twice, or nested in a call with itself, is one database", async () => {
    const db = connect(binding);

    expect(await withDatabase([db, db], () => User.count())).toBe(0);
    expect(await withDatabase(db, () => withDatabase(db, () => User.count()))).toBe(0);
  });
});
