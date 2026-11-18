import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { belongsTo, InvalidModel, Model } from "../../packages/active-record/src/index.ts";
import { openHarness, type Harness } from "../support/harness.ts";

class Topic extends Model.define({
  id: { type: "integer", null: false },
  reactionsCount: "integer",
}) {
  static table = "topics";
}

class Picture extends Model.define({
  id: { type: "integer", null: false },
  reactionsCount: "integer",
}) {
  static table = "pictures";
}

class Reaction extends Model.define({
  id: { type: "integer", null: false },
  reactableType: "string",
  reactableId: "integer",
}) {
  static table = "reactions";
  reactable = belongsTo([Topic, Picture], { counterCache: "reactionsCount", optional: true });
}

describe("a polymorphic belongsTo's counter cache", () => {
  let harness: Harness;
  const db = () => harness.connect();
  const counts = async () => [
    Number((await harness.exec("SELECT reactions_count AS n FROM topics WHERE id = 1"))[0]?.n),
    Number((await harness.exec("SELECT reactions_count AS n FROM pictures WHERE id = 1"))[0]?.n),
  ];

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.reset("reactions", "pictures", "topics");
    await harness.exec("INSERT INTO topics (id, reactions_count) VALUES (1, 0)");
    await harness.exec("INSERT INTO pictures (id, reactions_count) VALUES (1, 0)");
  });

  test("counts a record on the Model its type names", async () => {
    await db().model(Reaction).create({ reactableType: "Picture", reactableId: 1 });

    expect(await counts()).toEqual([0, 1]);
  });

  test("counts a destroyed record out of the Model its type names", async () => {
    await harness.exec("UPDATE topics SET reactions_count = 1");
    await harness.exec(
      "INSERT INTO reactions (id, reactable_type, reactable_id) VALUES (1, 'Topic', 1)",
    );

    await (await db().model(Reaction).find(1)).destroy();

    expect(await counts()).toEqual([0, 0]);
  });

  test("moves the count when set to a record of another Model", async () => {
    const reaction = await db().model(Reaction).create({ reactableType: "Topic", reactableId: 1 });
    const picture = await db().model(Picture).find(1);

    reaction.reactable.set(picture);
    await reaction.save();

    expect(await counts()).toEqual([0, 1]);
    expect(picture.reactionsCount).toBe(1);
  });

  test("each listed Model must declare the attribute: InvalidModel at first use", () => {
    class Bare extends Model.define({ id: { type: "integer", null: false } }) {
      static table = "pictures";
    }
    class Miscounted extends Model.define({
      id: { type: "integer", null: false },
      reactableType: "string",
      reactableId: "integer",
    }) {
      static table = "reactions";
      // @ts-expect-error the attribute is one every listed Model has
      reactable = belongsTo([Topic, Bare], { counterCache: "reactionsCount" });
    }

    expect(() => db().model(Miscounted).build()).toThrow(
      new InvalidModel(
        'Miscounted association "reactable": Bare has no attribute "reactionsCount" (check counterCache)',
      ),
    );
  });
});
