import { afterAll, beforeAll, beforeEach, describe, expect, test, vi } from "vite-plus/test";
import { Model, withDatabase } from "../../../packages/active-record/src/index.ts";
import {
  d1,
  connect,
  type QueryEvent,
} from "../../../packages/active-record/src/adapters/d1/index.ts";
import { createTestDatabase, type TestDatabase } from "../../support/d1.ts";

// Level 1 reads the binding from cloudflare:workers; here, this test's D1.
const workers: { env: Record<string, unknown> } = { env: {} };
vi.mock("cloudflare:workers", () => workers);

// An app's base class with an app-wide listener (#78), as application-record.ts would declare it.
const logged: QueryEvent[] = [];
abstract class ApplicationRecord extends Model {
  // Its generated schema names the binding (these Models declare their own attributes).
  static override schema = { adapter: d1({ binding: "DB" }), tables: {}, models: {} };
  static override onQuery = (event: QueryEvent) => {
    logged.push(event);
  };
}

class User extends ApplicationRecord.define({
  id: { type: "integer", null: false },
  email: "string",
}) {
  static table = "users";
}
class Post extends ApplicationRecord.define({
  id: { type: "integer", null: false },
  userId: "integer",
  title: "string",
}) {
  static table = "posts";
}

let binding: TestDatabase;
let dispose: () => Promise<void>;
beforeAll(async () => {
  ({ db: binding, dispose } = await createTestDatabase());
  workers.env = { DB: binding };
});
afterAll(() => dispose());
beforeEach(() => {
  logged.length = 0;
});

describe("an app-wide onQuery on the base class", () => {
  test("sees every statement of every Model built on it, with the Model's name, whichever database runs it", async () => {
    const db = connect(binding);

    await db.model(User).count(); // an explicit database
    await withDatabase(connect(binding), () => Post.count()); // the request's
    await User.count(); // the Model's binding

    expect(logged.map(({ model, sql }) => [model, sql.split(" ")[0]])).toEqual([
      ["User", "SELECT"],
      ["Post", "SELECT"],
      ["User", "SELECT"],
    ]);
    expect(logged[0]).toMatchObject({ params: [], durationMs: expect.any(Number) });
  });
});
