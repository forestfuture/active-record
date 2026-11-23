import { afterAll, beforeAll, beforeEach, describe, expect, test } from "vite-plus/test";
import { Model, ReadonlyRecord } from "../../packages/active-record/src/index.ts";
import type { QueryEvent } from "../../packages/active-record/src/executor.ts";
import { openHarness, type Harness } from "../support/harness.ts";

/** What the callbacks below heard, in order. */
const heard: string[] = [];

class Shelf extends Model.define({
  id: { type: "integer", null: false },
  name: "string",
  updatedAt: "datetime",
}) {
  static table = "shelves";
  static {
    this.validates("name", { presence: true });
    this.beforeSave(() => void heard.push("beforeSave"));
    this.beforeDestroy(() => void heard.push("beforeDestroy"));
  }
}

describe("read-only records (#358)", () => {
  let harness: Harness;

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());
  beforeEach(async () => {
    heard.length = 0;
    await harness.reset("volumes", "shelves");
    await harness.exec("INSERT INTO shelves (id, name) VALUES (1, 'Fiction')");
  });

  /** A Database whose statements are recorded in `events`. */
  const recorded = (events: QueryEvent[]) =>
    harness.connect({ onQuery: (event) => void events.push(event) });
  /** Shelf 1's row as stored. */
  const storedShelf = async () => (await harness.exec("SELECT name FROM shelves WHERE id = 1"))[0];
  /** Shelf 1, loaded and marked read-only, with `events` recording what's sent after. */
  const readonlyShelf = async (events: QueryEvent[]) => {
    const shelf = await recorded(events).model(Shelf).find(1);
    shelf.markReadonly();
    events.length = 0;
    return shelf;
  };

  describe("a record marked read-only", () => {
    test("says it's read-only, and a loaded one isn't", async () => {
      const shelf = await harness.connect().model(Shelf).find(1);
      expect(shelf.isReadonly()).toBe(false);

      shelf.markReadonly();

      expect(shelf.isReadonly()).toBe(true);
    });

    test("can't be saved: it throws, runs nothing and sends nothing", async () => {
      const events: QueryEvent[] = [];
      const shelf = await readonlyShelf(events);
      shelf.name = "";

      const saving = shelf.save();

      await expect(saving).rejects.toThrow(ReadonlyRecord);
      await expect(saving).rejects.toMatchObject({ record: shelf, action: "save" });
      expect(heard).toEqual([]);
      expect(shelf.errors.size).toBe(0); // not validated
      expect(events).toEqual([]);
      expect(await storedShelf()).toEqual({ name: "Fiction" });
    });
  });
});
