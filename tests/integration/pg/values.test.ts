import { afterAll, afterEach, beforeAll, describe, expect, test } from "vite-plus/test";
import { column, Model, sql } from "../../../packages/active-record/src/index.ts";
import { connect, type QueryEvent } from "../../../packages/pg-record/src/index.ts";
import { openPgSchema, type PgSchema } from "../../support/pg.ts";

class User extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
  age: "integer",
}) {
  static table = "users";
}

class JsonValue extends Model.define({ id: { type: "integer", null: false }, value: "json" }) {
  static table = "json_values";
}

// What Postgres gives that D1 can't: bigints, and its own detail for onQuery (#269).
describe("pg-record's values", () => {
  let schema: PgSchema;
  const events: QueryEvent[] = [];
  const users = () => connect(schema.url, { onQuery: (event) => events.push(event) }).model(User);

  beforeAll(async () => {
    schema = await openPgSchema();
  });
  afterAll(() => schema.dispose());
  afterEach(async () => {
    events.length = 0;
    await schema.pool.query({ text: "DELETE FROM users" });
    await schema.pool.query({ text: "DELETE FROM json_values" });
  });

  test("a bigint reads as a number while it's a safe integer", async () => {
    const age = Number.MAX_SAFE_INTEGER;
    await schema.pool.query({
      text: "INSERT INTO users (id, email, age) VALUES (1, 'a@example.com', $1)",
      values: [age],
    });

    expect((await users().find(1)).age).toBe(age);
  });

  test("a bigint past a safe integer fails when it's read, naming the attribute", async () => {
    await schema.pool.query({
      text: "INSERT INTO users (id, email, age) VALUES (1, 'a@example.com', 9007199254740993)",
    });

    await expect(users().find(1)).rejects.toThrow(
      new TypeError('User: 9007199254740993 isn\'t an integer for "age"'),
    );
    await expect(users().pluck("age")).rejects.toThrow(TypeError);
  });

  test("a ? in an sql fragment's text is Postgres's own, not a placeholder: jsonb's key test", async () => {
    const values = connect(schema.url).model(JsonValue);
    await values.insertAll([
      { id: 1, value: { theme: "dark" } },
      { id: 2, value: { size: 3 } },
    ]);

    const themed = await values.where(sql`${column("value")} ? ${"theme"}`).pluck("id");

    expect(themed).toEqual([1]);
  });

  test("onQuery hears Postgres's command and row count as meta", async () => {
    await users().create({ email: "a@example.com" });
    await users().pluck("email");

    expect(events.map(({ meta }) => meta)).toEqual([
      { command: "INSERT", rowCount: 1 },
      { command: "SELECT", rowCount: 1 },
    ]);
  });
});
