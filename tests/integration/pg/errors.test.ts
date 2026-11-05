import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { InvalidForeignKey, Model } from "../../../packages/active-record/src/index.ts";
import { connect } from "../../../packages/pg-record/src/index.ts";
import { openPgSchema, type PgSchema } from "../../support/pg.ts";

class User extends Model.define({
  id: { type: "integer", null: false },
  email: { type: "string", null: false },
}) {
  static table = "users";
}

class Post extends Model.define({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
}) {
  static table = "posts";
}

// What Postgres's errors say where D1's can't (the constraint-tables allowed difference, #269).
describe("pg-record's constraint errors", () => {
  let schema: PgSchema;

  beforeAll(async () => {
    schema = await openPgSchema();
  });
  afterAll(() => schema.dispose());

  test("a batch's foreign-key failure names its table and columns, even when it writes to several", async () => {
    const db = connect(schema.url);

    const error: unknown = await db
      .batch([
        db.model(User).toInsert({ id: 1, email: "a@example.com" }),
        db.model(Post).toInsert({ userId: 99, title: "Orphan" }),
      ])
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(InvalidForeignKey);
    expect(error).toMatchObject({ table: "posts", columns: ["user_id"], attributes: ["userId"] });
  });
});
