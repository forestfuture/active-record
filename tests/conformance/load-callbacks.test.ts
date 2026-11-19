import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { Model } from "../../packages/active-record/src/index.ts";
import { openHarness, type Harness } from "../support/harness.ts";

const log: string[] = [];

class Person extends Model.define({
  id: { type: "integer", null: false },
  email: "string",
}) {
  static table = "users";

  static {
    this.afterInitialize((person) => void log.push(`afterInitialize ${person.email}`));
    this.afterFind((person) => void log.push(`afterFind ${person.email}`));
  }
}

describe("afterFind and afterInitialize", () => {
  let harness: Harness;
  const people = () => harness.connect().model(Person);

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    await harness.reset("users");
    await harness.exec("INSERT INTO users (id, email) VALUES (1, 'a@example.com')");
    await harness.exec("INSERT INTO users (id, email) VALUES (2, 'b@example.com')");
    log.length = 0;
  });

  test("a query runs afterFind, then afterInitialize, for each record it loads", async () => {
    await people().order({ id: "asc" }).toArray();

    expect(log).toEqual([
      "afterFind a@example.com",
      "afterInitialize a@example.com",
      "afterFind b@example.com",
      "afterInitialize b@example.com",
    ]);
  });
});
