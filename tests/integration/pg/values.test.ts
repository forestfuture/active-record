import { afterAll, afterEach, beforeAll, describe, expect, test } from "vite-plus/test";
import { belongsTo, column, Model, sql } from "../../../packages/active-record/src/index.ts";
import {
  connect,
  type QueryEvent,
} from "../../../packages/active-record/src/adapters/postgresql/index.ts";
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

// A text foreign key to an integer key, which Postgres links by the key's digits.
class Note extends Model.define({ id: { type: "integer", null: false }, label: "string" }) {
  static table = "samples";
  owner = belongsTo(User, { foreignKey: "label" });
}

// What Postgres gives that D1 can't: bigints, and its own detail for onQuery (#269).
describe("the PostgreSQL adapter's values", () => {
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
    await schema.pool.query({ text: "DELETE FROM samples" });
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

  test("its SQL reads the same with standard_conforming_strings off", async () => {
    const url = new URL(schema.url);
    url.searchParams.set(
      "options",
      `${url.searchParams.get("options")} -c standard_conforming_strings=off`,
    );
    const db = connect(url.toString());
    await db.model(User).insertAll([{ id: 7, email: "a@example.com" }]);
    // Spaces around the digits, which the key test reads with \s: a condition casts " 7" to 7.
    await db.model(Note).insertAll([{ id: 1, label: " 7" }]);

    const [note] = await db.model(Note).includes("owner").toArray();

    expect(note!.loaded("owner")?.email).toBe("a@example.com");
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
