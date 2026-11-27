import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { belongsTo, hasMany, Model } from "../../packages/arbor/src/index.ts";
import { openHarness, type Harness } from "../support/harness.ts";

// A measure found by its real ratio or its integer quantity, which counts the notes on it.
class Measure extends Model.define({
  id: { type: "integer", null: false },
  ratio: "real",
  quantity: "integer",
  enabled: "integer",
}) {
  static table = "samples";

  notes = hasMany(Note, { foreignKey: "body", primaryKey: "ratio" });
  byQuantity = hasMany(Note, { foreignKey: "body", primaryKey: "quantity" });
}

// A note on a topic, whose text body holds a measure's ratio, or its quantity.
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
    counterCache: "enabled",
  });
}

// A topic, which reaches the measures its notes' bodies hold.
class Topic extends Model.define({ id: { type: "integer", null: false } }) {
  static table = "topics";

  notes = hasMany(Note, { foreignKey: "topicId" });
  measures = hasMany(Measure, { through: "notes", source: "measure" });
}

// Text holding a number, selected for a number key, is the number it holds, as a condition casts
// it: for a real, with a point or an exponent (#617), and for any key, nothing past its range.
describe("text selected for a number key", () => {
  let harness: Harness;
  const db = () => harness.connect();

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.reset("replies", "topics", "samples");
    await harness.exec("INSERT INTO topics (id) VALUES (1)");
    await harness.exec(
      "INSERT INTO samples (id, ratio, quantity, enabled) VALUES (1, 9, 7, 1), (2, 100, 8, 1), (3, 5, 9, 1)",
    );
    await harness.exec(
      "INSERT INTO replies (id, topic_id, body) VALUES (1, 1, '9.0'), (2, 1, '1e2'), (3, 1, ' .5e1 ')",
    );
  });

  test("a join finds the measures whose reals the notes' bodies hold", async () => {
    const ids = await db().model(Measure).joins("notes").order({ id: "asc" }).pluck("id");

    expect(ids).toEqual([1, 2, 3]);
  });

  test("a through association reads the reals its records' text holds", async () => {
    const topic = await db().model(Topic).find(1);

    expect(await topic.measures().order({ id: "asc" }).pluck("id")).toEqual([1, 2, 3]);
  });

  test("a through association preloads the reals its records' text holds", async () => {
    const [topic] = await db().model(Topic).includes("measures").toArray();

    expect(
      topic!
        .loaded("measures")
        .map(({ id }) => id)
        .sort(),
    ).toEqual([1, 2, 3]);
  });

  test("destroying a record counts it out of the real its text holds", async () => {
    const note = await db().model(Note).find(2);

    await note.destroy();

    expect(await db().model(Measure).order({ id: "asc" }).pluck("enabled")).toEqual([1, 0, 1]);
  });

  test("text past a real's range links nothing, without an error", async () => {
    await harness.exec("DELETE FROM replies");
    await harness.exec(
      "INSERT INTO replies (id, topic_id, body) VALUES (4, 1, '1e400'), (5, 1, '-1e400'), (6, 1, '1e-400'), (7, 1, '1e10000')",
    );

    expect(await db().model(Measure).joins("notes").count()).toBe(0);
  });

  test("text past an integer's range links nothing, without an error", async () => {
    await harness.exec("DELETE FROM replies");
    await harness.exec(
      "INSERT INTO replies (id, topic_id, body) VALUES (4, 1, '99999999999999999999'), (5, 1, '-99999999999999999999')",
    );

    expect(await db().model(Measure).joins("byQuantity").count()).toBe(0);
  });
});
