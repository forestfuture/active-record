import fc from "fast-check";
import { afterAll, beforeAll, describe, expect, test } from "vite-plus/test";
import { Model } from "../../packages/active-record/src/index.ts";
import { openHarness, type Harness } from "../support/harness.ts";
import { jsonValues } from "../support/json-values.ts";
import { SLOW_RUNS, SLOW_TIMEOUT } from "../support/properties.ts";
import { storable } from "../support/storable.ts";

class Sample extends Model.define({ id: { type: "integer", null: false }, settings: "json" }) {
  static table = "samples";
}

// A JSON attribute is saved as text and parsed back, so any JSON value, a top-level number or
// string and keys like `__proto__` included, must come back as it went in (#122).
describe("a JSON attribute, saved and read back through the database", () => {
  let harness: Harness;
  const samples = () => harness.connect().model(Sample);

  beforeAll(async () => {
    harness = await openHarness();
  });
  afterAll(() => harness.dispose());

  test("is the value that was saved, key for key", { timeout: SLOW_TIMEOUT }, async () => {
    await fc.assert(
      fc.asyncProperty(storable(jsonValues), async (value) => {
        const created = await samples().create({ settings: value as never });
        const reloaded = await samples().find(created.id);

        // JSON text compares key order and every own key; `toEqual` would forgive a prototype.
        expect(JSON.stringify(reloaded.settings)).toBe(JSON.stringify(value));
      }),
      SLOW_RUNS,
    );
  });
});
