import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { belongsTo, connect, hasMany, Model, sql } from "../../src/index.ts";
import { createTestDatabase, type TestDatabase } from "../support/d1.ts";

class Note extends Model.define({
  id: { type: "string", null: false },
  notebookId: "string",
  body: "string",
}) {
  static table = "notes";

  notebook = belongsTo(Notebook);
}

class Notebook extends Model.define({
  id: { type: "string", null: false },
  title: "string",
  color: "string",
}) {
  static table = "notebooks";

  notes = hasMany(Note);
}

// The preloads select a limited query's keys with a subquery of it (#217), so both must pick the
// same records. The notebooks and notes are written out of key order: reading the table and
// reading the key's index give their rows in different orders.
describe("preloading for a limited query", () => {
  let binding: TestDatabase;
  let dispose: () => Promise<void>;
  const db = () => connect(binding);
  const notebooks = () => db().model(Notebook);
  const notesOf = (notebook: Notebook) => [
    notebook.id,
    notebook.loaded("notes").map((note) => note.body),
  ];

  beforeAll(async () => {
    ({ db: binding, dispose } = await createTestDatabase(
      new URL("../fixtures/sqlite/generated-ids.sql", import.meta.url),
    ));
    await binding.batch([
      binding.prepare(
        "INSERT INTO notebooks (id, title, color) VALUES ('c', 'C', 'red'), ('b', 'B', 'red'), ('a', 'A', 'red')",
      ),
      binding.prepare(
        "INSERT INTO notes (id, notebook_id, body) VALUES ('n3', 'c', 'On c'), ('n2', 'b', 'On b'), ('n1', 'a', 'On a')",
      ),
    ]);
  });
  afterAll(() => dispose());

  test("a limit with no order preloads for the records it found, in key order", async () => {
    const found = await notebooks().limit(2).includes("notes").toArray();

    expect(found.map(notesOf)).toEqual([
      ["a", ["On a"]],
      ["b", ["On b"]],
    ]);
  });

  test("a limit whose order ties ends the order with the key", async () => {
    const found = await notebooks().order({ color: "asc" }).limit(2).includes("notes").toArray();

    expect(found.map(notesOf)).toEqual([
      ["a", ["On a"]],
      ["b", ["On b"]],
    ]);
  });

  test("an offset preloads for the records past it", async () => {
    const found = await notebooks().order({ title: "desc" }).offset(1).includes("notes").toArray();

    expect(found.map(notesOf)).toEqual([
      ["b", ["On b"]],
      ["a", ["On a"]],
    ]);
  });

  test("take() preloads for the record it found", async () => {
    const found = await notebooks().includes("notes").take();

    expect(found && notesOf(found)).toEqual(["a", ["On a"]]);
  });

  test("an order by an sql fragment that ties ends with the key", async () => {
    const found = await notebooks()
      .order(sql`color`)
      .limit(2)
      .includes("notes")
      .toArray();

    expect(found.map(notesOf)).toEqual([
      ["a", ["On a"]],
      ["b", ["On b"]],
    ]);
  });

  test("a level under the limited one preloads for the records above it", async () => {
    const found = await notebooks().limit(2).includes({ notes: "notebook" }).toArray();

    const notebookOfNotes = found.map((notebook) =>
      notebook.loaded("notes").map((note) => note.loaded("notebook")?.id),
    );
    expect(notebookOfNotes).toEqual([["a"], ["b"]]);
  });

  test("a belongsTo preloads for the limited records' foreign keys", async () => {
    const found = await db().model(Note).limit(2).includes("notebook").toArray();

    expect(found.map((note) => [note.id, note.loaded("notebook")?.id])).toEqual([
      ["n1", "a"],
      ["n2", "b"],
    ]);
  });
});
