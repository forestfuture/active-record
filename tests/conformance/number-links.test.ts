import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { belongsTo, hasMany, Model } from "../../packages/arbor/src/index.ts";
import { openHarness, type Harness } from "../support/harness.ts";

// A measure found by its real ratio or its integer quantity, which counts the notes on it.
class Measure extends Model.define({
  id: { type: "integer", null: false },
  ratio: "real",
  quantity: "integer",
  notesCount: { type: "integer", column: "enabled" },
}) {
  static table = "samples";

  notes = hasMany(Note, { foreignKey: "body", primaryKey: "ratio" });
  byQuantity = hasMany(Note, { foreignKey: "body", primaryKey: "quantity" });
}

// A price kept as a decimal to the cent, which counts the notes on it.
class Price extends Model.define({
  id: { type: "integer", null: false },
  price: { type: "decimal", precision: 10, scale: 2 },
  notesCount: "integer",
}) {
  static table = "ledger_lines";

  notes = hasMany(Note, { foreignKey: "body", primaryKey: "price" });
}

// A note on a topic, whose text body holds a measure's ratio or a price.
class Note extends Model.define({
  id: { type: "integer", null: false },
  topicId: "integer",
  body: { type: "string", null: false },
}) {
  static table = "replies";

  measure = belongsTo(Measure, {
    foreignKey: "body",
    primaryKey: "ratio",
    optional: true,
    counterCache: "notesCount",
  });
  price = belongsTo(Price, {
    foreignKey: "body",
    primaryKey: "price",
    optional: true,
    counterCache: "notesCount",
  });
}

// A topic, which reaches the measures and the prices its notes' bodies hold.
class Topic extends Model.define({ id: { type: "integer", null: false } }) {
  static table = "topics";

  notes = hasMany(Note, { foreignKey: "topicId" });
  measures = hasMany(Measure, { through: "notes", source: "measure" });
  prices = hasMany(Price, { through: "notes", source: "price" });
}

// Text holding a number, selected for a number key, is the number it holds, as a condition casts
// it: for a real or a decimal, with a point or an exponent (#617), and for any key, nothing past
// its range.
describe("text selected for a number key", () => {
  let harness: Harness;
  const db = () => harness.connect();

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.reset("replies", "topics", "samples", "ledger_lines");
    await harness.exec("INSERT INTO topics (id) VALUES (1)");
  });

  /** Notes on the topic with these bodies, numbered from 1. */
  const insertNotes = async (...bodies: string[]) => {
    for (const [index, body] of bodies.entries()) {
      await harness.exec("INSERT INTO replies (id, topic_id, body) VALUES (?, 1, ?)", [
        index + 1,
        body,
      ]);
    }
  };

  describe("for a real", () => {
    beforeEach(async () => {
      await harness.exec(
        "INSERT INTO samples (id, ratio, quantity, enabled) VALUES (1, 9, 7, 1), (2, 100, 8, 1), (3, 5, 9, 1)",
      );
    });

    test("a join finds the measures whose reals the notes' bodies hold", async () => {
      await insertNotes("9.0", "1e2", " .5e1 ");

      expect(await db().model(Measure).joins("notes").order({ id: "asc" }).pluck("id")).toEqual([
        1, 2, 3,
      ]);
    });

    test("a through association reads the reals its records' text holds", async () => {
      await insertNotes("9.0", "1e2", " .5e1 ");
      const topic = await db().model(Topic).find(1);

      expect(await topic.measures().order({ id: "asc" }).pluck("id")).toEqual([1, 2, 3]);
    });

    test("a through association preloads the reals its records' text holds", async () => {
      await insertNotes("9.0", "1e2", " .5e1 ");
      const [topic] = await db().model(Topic).includes("measures").toArray();

      expect(
        topic!
          .loaded("measures")
          .map(({ id }) => id)
          .sort((a, b) => a - b),
      ).toEqual([1, 2, 3]);
    });

    test("destroying a record counts it out of the real its text holds", async () => {
      await insertNotes("9.0", "1e2", " .5e1 ");
      const note = await db().model(Note).find(2);

      await note.destroy();

      expect(await db().model(Measure).order({ id: "asc" }).pluck("notesCount")).toEqual([1, 0, 1]);
    });

    test("text past a real's range links nothing, without an error", async () => {
      await insertNotes("1e400", "-1e400", "1e-400", "1e10000");

      expect(await db().model(Measure).joins("notes").count()).toBe(0);
    });

    test("text past an integer's range links nothing, without an error", async () => {
      await insertNotes("99999999999999999999", "-99999999999999999999");

      expect(await db().model(Measure).joins("byQuantity").count()).toBe(0);
    });
  });

  describe("for a decimal", () => {
    beforeEach(async () => {
      await harness.exec(
        "INSERT INTO ledger_lines (id, price, notes_count) VALUES (1, 9.5, 1), (2, 100, 1), (3, 5, 1)",
      );
    });

    test("a join finds the decimals the notes' bodies hold", async () => {
      await insertNotes("9.50", "1e2", " .5e1 ");

      expect(await db().model(Price).joins("notes").order({ id: "asc" }).pluck("id")).toEqual([
        1, 2, 3,
      ]);
    });

    test("a through association reads the decimals its records' text holds", async () => {
      await insertNotes("9.50", "1e2", " .5e1 ");
      const topic = await db().model(Topic).find(1);

      expect(await topic.prices().order({ id: "asc" }).pluck("id")).toEqual([1, 2, 3]);
    });

    test("a through association preloads the decimals its records' text holds", async () => {
      await insertNotes("9.50", "1e2", " .5e1 ");
      const [topic] = await db().model(Topic).includes("prices").toArray();

      expect(
        topic!
          .loaded("prices")
          .map(({ id }) => id)
          .sort((a, b) => a - b),
      ).toEqual([1, 2, 3]);
    });

    test("destroying a record counts it out of the decimal its text holds", async () => {
      await insertNotes("9.50", "1e2", " .5e1 ");
      const note = await db().model(Note).find(2);

      await note.destroy();

      expect(await db().model(Price).order({ id: "asc" }).pluck("notesCount")).toEqual([1, 0, 1]);
    });

    test("a join compares the number unrounded, so more digits than the scale find none", async () => {
      await insertNotes("9.504", "1e2", " .5e1 ");

      expect(await db().model(Price).joins("notes").order({ id: "asc" }).pluck("id")).toEqual([
        2, 3,
      ]);
    });

    test("text past a decimal's range links nothing, without an error", async () => {
      await insertNotes("1e400", "-1e400", "1e-400", "1e10000");

      expect(await db().model(Price).joins("notes").count()).toBe(0);
    });
  });
});
