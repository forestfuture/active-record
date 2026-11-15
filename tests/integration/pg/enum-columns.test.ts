import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { Model } from "../../../packages/active-record/src/index.ts";
import { connect } from "../../../packages/active-record/src/adapters/postgresql/index.ts";
import { openPgSchema, type PgSchema } from "../../support/pg.ts";

class Ticket extends Model.define({
  id: { type: "integer", null: false },
  state: { type: "string", enum: ["open", "in_progress", "closed"] },
}) {}

// A string enum over a column of a Postgres enum type, which binds its names as text (#340).
describe("an enum attribute over a Postgres enum column", () => {
  let schema: PgSchema;
  const tickets = () => connect(schema.url).model(Ticket);

  beforeAll(async () => {
    schema = await openPgSchema([]);
    await schema.pool.query({
      text: "CREATE TYPE ticket_state AS ENUM ('open', 'in_progress', 'closed', 'archived')",
    });
    await schema.pool.query({
      text: "CREATE TABLE tickets (id BIGINT PRIMARY KEY, state ticket_state)",
    });
  });
  afterAll(() => schema.dispose());
  beforeEach(async () => {
    await schema.pool.query({ text: "DELETE FROM tickets" });
  });

  test("writes and finds by name, one or a list, in single and bulk writes", async () => {
    await tickets().createOrThrow({ id: 1, state: "open" });
    await tickets().insertAll([
      { id: 2, state: "in_progress" },
      { id: 3, state: "closed" },
    ]);
    await tickets().where({ id: 3 }).updateAll({ state: "open" });
    const ids = async (relation: ReturnType<typeof tickets>) =>
      (await relation.order({ id: "asc" }).toArray()).map((each) => each.id);

    expect(await ids(tickets().where({ state: ["open", "closed"] }))).toEqual([1, 3]);
    expect(await ids(tickets().whereNot({ state: "open" }))).toEqual([2]);
    expect(await ids(tickets().inProgress())).toEqual([2]);
  });

  test("reads a label the Model doesn't list as null", async () => {
    await schema.pool.query({ text: "INSERT INTO tickets (id, state) VALUES (1, 'archived')" });

    expect((await tickets().find(1)).state).toBeNull();
  });
});
