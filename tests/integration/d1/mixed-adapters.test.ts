import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { Model, NoDatabase, withDatabase } from "../../../packages/active-record/src/index.ts";
import { connect, d1 } from "../../../packages/active-record/src/adapters/d1/index.ts";
import {
  connect as connectPostgres,
  postgresql,
} from "../../../packages/active-record/src/adapters/postgresql/index.ts";
import { createTestDatabase, type TestDatabase } from "../../support/d1.ts";

abstract class D1Record extends Model {
  static override schema = { adapter: d1({ binding: "DB" }), tables: {} };
}

class User extends D1Record.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
}) {}

abstract class PgRecord extends Model {
  static override schema = { adapter: postgresql({ binding: "DATABASE_URL" }), tables: {} };
}

class Member extends PgRecord.define({ id: { type: "integer", null: false } }) {
  static override table = "users";
}

// A request with databases on two adapters (#305). Its Postgres side, which needs a server, is in
// tests/integration/pg/mixed-adapters.test.ts.
describe("a request with a D1 database and a Postgres one, outside a Worker", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;
  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
  });
  afterAll(() => dispose());

  // A Postgres database opens no connection until it's queried, so this one is never reached.
  const postgres = () => connectPostgres("postgres://localhost:1/never_reached");

  test("a D1 Model's statics use the request's D1 database, the only one on its adapter", async () => {
    const count = await withDatabase([connect(binding), postgres()], async () => {
      await User.create({ email: "d1@example.com" });
      return User.where({ email: "d1@example.com" }).count();
    });

    expect(count).toBe(1);
  });

  test("two databases on one adapter still can't be told apart by a binding", async () => {
    const twice = withDatabase([postgres(), postgres()], () => Member.count());

    await expect(twice).rejects.toThrow(
      new NoDatabase(
        "No database for this query: withDatabase was given several, and outside a Worker a " +
          "binding can't tell which. Wrap the code in withDatabase(connect(…), …), or use db.model(Model)",
      ),
    );
  });
});
