import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { Model, StaleRecord } from "../../packages/active-record/src/index.ts";
import type { QueryEvent } from "../../packages/active-record/src/executor.ts";
import { openHarness, type Harness } from "../support/harness.ts";

/** A notebook whose `lockVersion` turns on optimistic locking. */
class Notebook extends Model.define({
  id: { type: "integer", null: false },
  title: "string",
  lockVersion: { type: "integer", null: false, default: () => 0 },
}) {
  static table = "notebooks";
}

describe("optimistic locking", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());

  const events: QueryEvent[] = [];
  const db = () => harness.connect({ onQuery: (event) => events.push(event) });
  const rows = (table: string) => harness.exec(`SELECT * FROM ${table} ORDER BY id`);
  beforeEach(async () => {
    events.length = 0;
    await harness.reset("pages", "notebooks", "drafts");
    await harness.exec("INSERT INTO notebooks (id, title) VALUES (1, 'Recipes')");
  });

  /** Two copies of notebook 1, as two requests load it. */
  async function twoCopies() {
    const first = await db().model(Notebook).find(1);
    const second = await db().model(Notebook).find(1);
    return [first, second] as const;
  }

  describe("saving", () => {
    test("the first copy's save increments lockVersion, and the stale copy's throws StaleRecord", async () => {
      const [first, second] = await twoCopies();

      first.title = "Soups";
      await first.saveOrThrow();
      second.title = "Breads";
      const saving = second.save();

      await expect(saving).rejects.toThrow(StaleRecord);
      await expect(saving).rejects.toMatchObject({ record: second, action: "update" });
      expect(first.lockVersion).toBe(1);
      expect(second.lockVersion).toBe(0);
      expect(second.title).toBe("Breads");
      expect(await rows("notebooks")).toMatchObject([{ title: "Soups", lock_version: 1 }]);
    });
  });
});
