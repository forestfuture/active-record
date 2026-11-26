import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { belongsTo, Model } from "../../../packages/arbor/src/index.ts";
import { connect } from "../../../packages/arbor/src/adapters/postgresql/index.ts";
import { openPgSchema, type PgSchema } from "../../support/pg.ts";

/** A shelf and its books, on the tables named `kind_shelves` and `kind_books`. */
function modelsOn(kind: "text" | "json") {
  class Shelf extends Model.define({ id: { type: "integer", null: false }, label: "json" }) {
    static table = `${kind}_shelves`;
  }

  class Book extends Model.define({ id: { type: "integer", null: false }, shelfLabel: "json" }) {
    static table = `${kind}_books`;

    shelf = belongsTo(Shelf, { foreignKey: "shelfLabel", primaryKey: "label" });
  }

  return { Shelf, Book };
}

// A json key linked to a json key is selected as it is, so it links where a condition on a json
// attribute compares: in two jsonb columns (the conformance suite's), or in two text columns. A
// json column has no equality, and fails both (#591).
describe("json keys on Postgres", () => {
  let schema: PgSchema;
  const db = () => connect(schema.url);

  beforeAll(async () => {
    schema = await openPgSchema([
      new URL("../../fixtures/postgres/json-keys.sql", import.meta.url),
    ]);
    await schema.pool.query({
      text: ["text", "json"]
        .map(
          (kind) =>
            `INSERT INTO ${kind}_shelves VALUES (1, '{"row":1}');` +
            `INSERT INTO ${kind}_books VALUES (1, '{"row":1}'), (2, '{"row":2}');`,
        )
        .join(""),
    });
  });
  afterAll(() => schema.dispose());

  test("in text columns, a preload and a join link them", async () => {
    const { Book } = modelsOn("text");

    const books = await db().model(Book).includes("shelf").order({ id: "asc" }).toArray();

    expect(books.map((book) => book.loaded("shelf")?.id ?? null)).toEqual([1, null]);
    expect(await db().model(Book).joins("shelf").pluck("id")).toEqual([1]);
  });

  test("in json columns, a join and a condition fail at Postgres", async () => {
    const { Book } = modelsOn("json");

    await expect(db().model(Book).joins("shelf").toArray()).rejects.toThrow(
      /operator does not exist: json = json/,
    );
    await expect(
      db()
        .model(Book)
        .where({ shelfLabel: { row: 1 } })
        .toArray(),
    ).rejects.toThrow(/operator does not exist: json = /);
  });
});
