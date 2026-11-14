import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { hasMany, InvalidModel, Model } from "../../packages/active-record/src/index.ts";
import type { QueryEvent } from "../../packages/active-record/src/executor.ts";
import { openHarness, type Harness } from "../support/harness.ts";

class Post extends Model.define({
  id: { type: "integer", null: false },
  userId: { type: "integer", null: false },
  title: { type: "string", null: false },
}) {
  static table = "posts";
}

describe("autosave: true (#37)", () => {
  let harness: Harness;
  const events: QueryEvent[] = [];
  const db = () => harness.connect({ onQuery: (event) => events.push(event) });

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.reset("comments", "profiles", "posts", "users");
    events.length = 0;
  });

  test("autosave takes only true: anything else is an InvalidModel", () => {
    class Owner extends Model.define({ id: { type: "integer", null: false } }) {
      static table = "users";

      posts = hasMany(Post, { foreignKey: "userId", autosave: false } as never);
    }

    expect(() => db().model(Owner).build({ id: 1 })).toThrow(
      new InvalidModel('Owner association "posts": autosave takes true'),
    );
  });
});
