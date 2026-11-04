import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { InvalidModel, Model } from "../../packages/active-record/src/index.ts";
import { connect, type QueryEvent } from "../../packages/d1-record/src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

// What D1 itself says: its meta and its messages. The portable halves are in tests/conformance.
class User extends Model.define({ id: "integer", email: "string" }) {
  static table = "users";
}

class Missing extends Model.define({ id: "integer" }) {
  static table = "no_such_table";
}

describe("D1's own detail", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase());
  });
  afterAll(() => dispose());

  test("onQuery's meta is D1's, with the rows it read", async () => {
    const queries: QueryEvent[] = [];

    await connect(binding, { onQuery: (event) => queries.push(event) })
      .model(User)
      .toArray();

    expect(queries[0]?.meta).toHaveProperty("rows_read");
  });

  test("a statement on a missing table fails with D1's error, which onQuery hears", async () => {
    const queries: QueryEvent[] = [];
    const db = connect(binding, { onQuery: (event) => queries.push(event) });

    await expect(db.model(Missing).toArray()).rejects.toThrow(/no such table: no_such_table/);
    expect(String(queries[0]?.error)).toMatch(/no such table/);
  });

  test("a missing table whose name was inferred names D1, with D1's error as its cause", async () => {
    const e = class extends Model.define({ id: "integer" }) {};

    const error: unknown = await connect(binding)
      .model(e)
      .toArray()
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(InvalidModel);
    expect(error).toHaveProperty("message", expect.stringContaining(`doesn't exist in D1 (`));
    expect(error).toHaveProperty("cause.message", expect.stringMatching(/no such table: es/));
  });
});
